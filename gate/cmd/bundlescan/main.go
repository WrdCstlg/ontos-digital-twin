// Command bundlescan makes the gate's run bundles fit to publish. CI keeps
// every run bundle of a gate job as an artifact of a public repository, so
// before the upload it rewrites the throwaway credentials a run creates, and
// refuses the kinds of secret that should never be in a bundle at all.
//
// Redacted in place: Ontology API tokens (ontos_<prefix>_<secret>, keeping the
// prefix, so a history can still be followed), session tokens (JWTs), session
// cookies and HTTP Basic credentials. They are found wherever they sit in a
// line, after a word character too: URL-encoded (Bearer%20ontos_…) or
// JSON-escaped (\nontos_…). A run's own are useless outside its throwaway
// stack, but there is no reason to publish them.
//
// Refused (exit 1, so nothing is uploaded): private keys, GitHub, AWS and
// Slack tokens, and Slack webhook URLs. One of those in a bundle is a defect
// to fix, not to hide. Refusals are judged on each line as it was read, so a
// redaction never hides one. Also refused: a line that, once redacted, still
// holds a secret after URL-decoding or JSON-unescaping; anything that is
// neither a regular file nor a directory, such as a symbolic link, which is
// never followed; and a file that cannot be read, or that cannot be written
// back once redacted. What was not scanned, or not redacted, is not published.
//
// Each line is judged on its own: a value split across lines is not found.
//
// It writes REDACTIONS.txt at the top of the directory: each file, line and
// kind it redacted or refused, never the value. It prints the same list, and
// each refusal as a GitHub Actions error annotation, because a refused bundle
// is not uploaded and the log is then all there is to say what and where.
//
// Exit codes: 0 publishable, 1 refused, 2 error.
//
//	bundlescan -dir <bundles>
package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Manifest is the name of the report bundlescan writes at the top of the directory.
const Manifest = "REDACTIONS.txt"

type rule struct {
	kind    string
	pattern *regexp.Regexp
	// replace is the replacement for what a redaction finds.
	replace string
}

// redactions run in this order, each on the line the one before left. The
// cookie rule runs before the JWT rule, so a session cookie reads
// ontos_session=[redacted] whatever its value. No replacement is matched by a
// rule again, so a second scan changes and reports nothing.
//
// None has a leading \b, which fails after a word character: Bearer%20ontos_…,
// %22ontos_…, a JSON-escaped \nontos_… or \neyJ…, and x_ontos_… would all
// slip past one.
var redactions = []rule{
	// 32 or more, rather than 32 and a \b, so a token followed by _ is found.
	{"ontology API token", regexp.MustCompile(`ontos_([A-Za-z0-9]{8})_[A-Za-z0-9]{32,}`), "ontos_${1}_[redacted]"},
	// The = may be URL-encoded. A value that starts with [ is already redacted.
	{"session cookie", regexp.MustCompile(`(ontos_session(?:=|%3[Dd]))[^\[;\s"'\\][^;\s"'\\]*`), "${1}[redacted]"},
	{"session token (JWT)", regexp.MustCompile(`eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`), "[redacted-jwt]"},
	// A header line, or a header in JSON, escaped JSON or a JavaScript object.
	{"HTTP Basic credentials", regexp.MustCompile(`(?i)(authorization[\\"']*\s*[:=]\s*[\\"']*basic\s+)[A-Za-z0-9+/_-]+=*`), "${1}[redacted]"},
}

// refusals are judged on each line as it was read, before any redaction.
var refusals = []rule{
	// PGP's is a PRIVATE KEY BLOCK.
	{kind: "private key", pattern: regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----`)},
	// Classic tokens are 36 characters after the prefix. Installation tokens,
	// Actions' GITHUB_TOKEN among them, are now ghs_<app id>_<JWT>, some 520
	// characters with dots in them, so the class takes . _ - and there is no
	// trailing \b.
	{kind: "GitHub token", pattern: regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9._-]{36,}|\bgithub_pat_[A-Za-z0-9_]{22,}`)},
	// AKIA is a long-lived key, ASIA a temporary one.
	{kind: "AWS access key", pattern: regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{kind: "Slack token", pattern: regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}|\bxapp-[A-Za-z0-9-]{10,}`)},
	{kind: "Slack webhook URL", pattern: regexp.MustCompile(`hooks\.slack\.com/services/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+`)},
}

type finding struct {
	path    string
	line    int
	kind    string
	refused bool
}

func main() {
	dir := flag.String("dir", "", "the directory of run bundles to scan, in place")
	flag.Parse()
	if *dir == "" {
		fmt.Fprintln(os.Stderr, "bundlescan: -dir is required")
		os.Exit(2)
	}
	code, err := run(*dir, os.Stdout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bundlescan: %v\n", err)
		os.Exit(2)
	}
	os.Exit(code)
}

// run scans every file under dir, redacts in place, writes and prints the
// manifest and returns the exit code: 0 publishable, 1 refused.
func run(dir string, out io.Writer) (int, error) {
	// Lstat: a link given as the directory would be walked as a link, and the
	// manifest written through it.
	info, err := os.Lstat(dir)
	if err != nil {
		return 0, err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return 0, fmt.Errorf("%s is a symbolic link; give the directory itself", dir)
	}
	if !info.IsDir() {
		return 0, fmt.Errorf("%s is not a directory", dir)
	}
	var findings []finding
	files := 0
	walkErr := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		rel, _ := filepath.Rel(dir, path)
		rel = filepath.ToSlash(rel)
		if err != nil {
			findings = append(findings, finding{path: rel, kind: "unreadable: " + err.Error(), refused: true})
			return nil
		}
		if d.IsDir() {
			return nil
		}
		// WalkDir never follows a link, but the upload would, and publish
		// whatever it points to unscanned.
		if !d.Type().IsRegular() {
			findings = append(findings, finding{path: rel, kind: "not a regular file: " + entryKind(d.Type()), refused: true})
			return nil
		}
		if rel == Manifest {
			return nil
		}
		files++
		found, err := scanFile(path)
		if err != nil {
			findings = append(findings, finding{path: rel, kind: "unreadable: " + err.Error(), refused: true})
			return nil
		}
		for _, f := range found {
			f.path = rel
			findings = append(findings, f)
		}
		return nil
	})
	if walkErr != nil {
		return 0, walkErr
	}
	refused := 0
	for _, f := range findings {
		if f.refused {
			refused++
		}
	}
	text := manifest(files, findings)
	// The manifest holds no value, so it is safe in a public log. A refused
	// bundle is not uploaded, so the log is where to see what and where.
	io.WriteString(out, text)
	for _, f := range findings {
		if f.refused {
			fmt.Fprintln(out, annotation(f))
		}
	}
	if err := writeManifest(filepath.Join(dir, Manifest), text); err != nil {
		return 0, err
	}
	fmt.Fprintf(out, "bundlescan: %d file(s), %d redacted, %d refused (%s)\n", files, len(findings)-refused, refused, Manifest)
	if refused > 0 {
		return 1, nil
	}
	return 0, nil
}

// entryKind names a directory entry that is neither a regular file nor a directory.
func entryKind(m fs.FileMode) string {
	switch {
	case m&fs.ModeSymlink != 0:
		return "symbolic link"
	case m&fs.ModeNamedPipe != 0:
		return "named pipe"
	case m&fs.ModeSocket != 0:
		return "socket"
	case m&fs.ModeDevice != 0:
		return "device"
	default:
		return "irregular file"
	}
}

// scanFile redacts what may be redacted and reports every finding, by line.
// It fails only if the file cannot be read. A file that cannot be written
// back has each line that needed redaction refused as unwritable.
func scanFile(path string) ([]finding, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var found []finding
	// Split on \n alone, so a \r stays on its line and a CRLF file keeps its
	// line endings.
	lines := bytes.Split(data, []byte("\n"))
	changed := false
	for i, line := range lines {
		redacted, f := scanLine(line, i+1)
		found = append(found, f...)
		if !bytes.Equal(redacted, line) {
			lines[i] = redacted
			changed = true
		}
	}
	if changed {
		if err := os.WriteFile(path, bytes.Join(lines, []byte("\n")), 0o644); err != nil {
			for i := range found {
				if !found[i].refused {
					found[i].kind = fmt.Sprintf("unwritable: %s not redacted (%v)", found[i].kind, err)
					found[i].refused = true
				}
			}
		}
	}
	return found, nil
}

// scanLine judges one line: the refusals on the line as it was read, then the
// redactions in order, then what the redacted line still holds once decoded.
func scanLine(line []byte, n int) ([]byte, []finding) {
	var found []finding
	for _, r := range refusals {
		if r.pattern.Match(line) {
			found = append(found, finding{line: n, kind: r.kind, refused: true})
		}
	}
	redacted := line
	for _, r := range redactions {
		if r.pattern.Match(redacted) {
			found = append(found, finding{line: n, kind: r.kind})
			redacted = r.pattern.ReplaceAll(redacted, []byte(r.replace))
		}
	}
	for _, kind := range encoded(redacted) {
		found = append(found, finding{line: n, kind: "encoded " + kind, refused: true})
	}
	return redacted, found
}

// encoded fails closed on what the rules cannot see in place: it URL-decodes
// and JSON-unescapes a redacted line, and names each kind of secret a decoded
// copy holds that the line itself does not.
func encoded(line []byte) []string {
	var kinds []string
	seen := map[string]bool{}
	for _, decoded := range [][]byte{percentDecode(line), jsonUnescape(line)} {
		if bytes.Equal(decoded, line) {
			continue
		}
		for _, rules := range [][]rule{redactions, refusals} {
			for _, r := range rules {
				if !seen[r.kind] && r.pattern.Match(decoded) && !r.pattern.Match(line) {
					seen[r.kind] = true
					kinds = append(kinds, r.kind)
				}
			}
		}
	}
	return kinds
}

// percentDecode undoes every %XX escape in b, wherever it is, and leaves a %
// that starts no escape as it is.
func percentDecode(b []byte) []byte {
	i := bytes.IndexByte(b, '%')
	if i < 0 {
		return b
	}
	out := append(make([]byte, 0, len(b)), b[:i]...)
	for ; i < len(b); i++ {
		if b[i] == '%' && i+2 < len(b) {
			if hi, ok := unhex(b[i+1]); ok {
				if lo, ok := unhex(b[i+2]); ok {
					out = append(out, hi<<4|lo)
					i += 2
					continue
				}
			}
		}
		out = append(out, b[i])
	}
	return out
}

// jsonUnescape undoes every JSON string escape in b, wherever it is, and
// leaves a backslash that starts no escape as it is.
func jsonUnescape(b []byte) []byte {
	i := bytes.IndexByte(b, '\\')
	if i < 0 {
		return b
	}
	out := append(make([]byte, 0, len(b)), b[:i]...)
	for ; i < len(b); i++ {
		if b[i] != '\\' || i+1 == len(b) {
			out = append(out, b[i])
			continue
		}
		switch c := b[i+1]; c {
		case '"', '\\', '/':
			out = append(out, c)
		case 'b':
			out = append(out, '\b')
		case 'f':
			out = append(out, '\f')
		case 'n':
			out = append(out, '\n')
		case 'r':
			out = append(out, '\r')
		case 't':
			out = append(out, '\t')
		case 'u':
			r, ok := hex4(b[i+2:])
			if !ok {
				out = append(out, b[i])
				continue
			}
			out = utf8.AppendRune(out, r)
			i += 4
		default:
			out = append(out, b[i])
			continue
		}
		i++
	}
	return out
}

// hex4 reads the four hex digits of a \u escape.
func hex4(b []byte) (rune, bool) {
	if len(b) < 4 {
		return 0, false
	}
	var r rune
	for _, c := range b[:4] {
		v, ok := unhex(c)
		if !ok {
			return 0, false
		}
		r = r<<4 | rune(v)
	}
	return r, true
}

func unhex(c byte) (byte, bool) {
	switch {
	case '0' <= c && c <= '9':
		return c - '0', true
	case 'a' <= c && c <= 'f':
		return c - 'a' + 10, true
	case 'A' <= c && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
}

// manifest lists every finding by file and line: what was done and the kind,
// never the value.
func manifest(files int, findings []finding) string {
	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].path != findings[j].path {
			return findings[i].path < findings[j].path
		}
		return findings[i].line < findings[j].line
	})
	var b strings.Builder
	fmt.Fprintf(&b, "bundlescan: %d file(s) scanned. Values are never listed here.\n", files)
	if len(findings) == 0 {
		b.WriteString("Nothing redacted or refused.\n")
	}
	for _, f := range findings {
		action := "redacted"
		if f.refused {
			action = "REFUSED"
		}
		fmt.Fprintf(&b, "%s:%d %s %s\n", f.path, f.line, action, f.kind)
	}
	return b.String()
}

// writeManifest replaces whatever is at path rather than write through it: a
// link there would otherwise send the manifest to wherever it points.
func writeManifest(path, text string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return os.WriteFile(path, []byte(text), 0o644)
}

// annotation is a GitHub Actions error annotation for a refusal: the file,
// the line when there is one, and the kind. Never the value.
func annotation(f finding) string {
	props := "file=" + escapeProperty(f.path)
	if f.line > 0 {
		props += ",line=" + strconv.Itoa(f.line)
	}
	return "::error " + props + "::" + escapeData(f.kind)
}

// escapeData and escapeProperty escape a workflow command's message and
// property values as the runner reads them (actions/toolkit, command.ts).
func escapeData(s string) string {
	return strings.NewReplacer("%", "%25", "\r", "%0D", "\n", "%0A").Replace(s)
}

func escapeProperty(s string) string {
	return strings.NewReplacer("%", "%25", "\r", "%0D", "\n", "%0A", ":", "%3A", ",", "%2C").Replace(s)
}
