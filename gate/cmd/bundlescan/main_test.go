package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, dir, rel, content string) string {
	t.Helper()
	p := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func read(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// scan runs bundlescan over dir and returns its exit code, what it printed and
// the manifest it wrote.
func scan(t *testing.T, dir string) (int, string, string) {
	t.Helper()
	var out bytes.Buffer
	code, err := run(dir, &out)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return code, out.String(), read(t, filepath.Join(dir, Manifest))
}

// The values below are assembled at run time, so no secret-shaped literal sits
// in the source for a secret scanner to trip on.
const (
	tokenSecret  = "abcdefghijklmnopqrstuvwxyz012345"
	token        = "ontos_zyVPjbCi_" + tokenSecret
	jwtSignature = "c2lnbmF0dXJlLXZhbHVl"
	jwt          = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9." + jwtSignature
	basicValue   = "dXNlcjpwYXNzd29yZA=="
)

var (
	awsKey = "AK" + "IA" + "ABCDEFGHIJKLMNOP"
	// An installation token as Actions' GITHUB_TOKEN now is: ghs_<app id>_<JWT>.
	installationToken = "gh" + "s_" + "1234567_" + "eyJ" + strings.Repeat("A", 120) + "." + strings.Repeat("b", 300) + "." + strings.Repeat("C", 86)
)

func TestRedactsWhatARunCreatesAndListsItWithoutValues(t *testing.T) {
	dir := t.TempDir()
	app := write(t, dir, "r_1/world-0001/logs/app.log", "boot\nauthorization: Bearer "+token+"\ncookie: ontos_session="+jwt+"; path=/\n")
	driver := write(t, dir, "r_1/world-0001/driver.log", "API token 0: ontos_zyVPjbCi…\n")
	code, out, manifest := scan(t, dir)
	if code != 0 {
		t.Fatalf("run = %d; want 0", code)
	}
	got := read(t, app)
	if strings.Contains(got, tokenSecret) || strings.Contains(got, jwtSignature) {
		t.Fatalf("secret left in place:\n%s", got)
	}
	if !strings.Contains(got, "ontos_zyVPjbCi_[redacted]") || !strings.Contains(got, "ontos_session=[redacted]") {
		t.Fatalf("redaction not as expected:\n%s", got)
	}
	// A token's printed prefix alone is not a token, and is left as it was.
	if read(t, driver) != "API token 0: ontos_zyVPjbCi…\n" {
		t.Fatalf("driver log changed: %q", read(t, driver))
	}
	for _, want := range []string{"r_1/world-0001/logs/app.log:2 redacted ontology API token", "r_1/world-0001/logs/app.log:3 redacted session cookie"} {
		if !strings.Contains(manifest, want) {
			t.Fatalf("manifest lacks %q:\n%s", want, manifest)
		}
	}
	for _, text := range []string{manifest, out} {
		if strings.Contains(text, "abcdefgh") || strings.Contains(text, "eyJ") {
			t.Fatalf("a value was listed or printed:\n%s", text)
		}
	}
}

func TestRedactsABareBearerJWT(t *testing.T) {
	dir := t.TempDir()
	p := write(t, dir, "r_1/world-0001/logs/app.log", "Authorization: Bearer "+jwt+"\n")
	code, _, manifest := scan(t, dir)
	if code != 0 {
		t.Fatalf("run = %d; want 0", code)
	}
	if got := read(t, p); got != "Authorization: Bearer [redacted-jwt]\n" {
		t.Fatalf("got %q", got)
	}
	if !strings.Contains(manifest, "r_1/world-0001/logs/app.log:1 redacted session token (JWT)\n") {
		t.Fatalf("manifest:\n%s", manifest)
	}
}

func TestRedactsHTTPBasicCredentials(t *testing.T) {
	dir := t.TempDir()
	p := write(t, dir, "r_1/world-0001/logs/sink.log",
		"Authorization: Basic "+basicValue+"\n"+
			`{"headers":{"authorization":"Basic `+basicValue+`"}}`+"\n"+
			`{"msg":"{\"authorization\":\"basic `+basicValue+`\"}"}`+"\n")
	code, _, manifest := scan(t, dir)
	if code != 0 {
		t.Fatalf("run = %d; want 0\n%s", code, manifest)
	}
	want := "Authorization: Basic [redacted]\n" +
		`{"headers":{"authorization":"Basic [redacted]"}}` + "\n" +
		`{"msg":"{\"authorization\":\"basic [redacted]\"}"}` + "\n"
	if got := read(t, p); got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	for _, line := range []string{"1", "2", "3"} {
		if !strings.Contains(manifest, "sink.log:"+line+" redacted HTTP Basic credentials\n") {
			t.Fatalf("line %s not reported:\n%s", line, manifest)
		}
	}
}

// A leading \b fails after a word character, which is where an encoded or
// escaped value sits.
func TestRedactsEncodedAndEscapedForms(t *testing.T) {
	cases := map[string]struct{ line, want string }{
		"URL-encoded bearer":        {"GET /x?h=Bearer%20" + token + " 200", "GET /x?h=Bearer%20ontos_zyVPjbCi_[redacted] 200"},
		"URL-encoded quote":         {"q=%22" + token + "%22", "q=%22ontos_zyVPjbCi_[redacted]%22"},
		"JSON-escaped newline":      {`{"msg":"sent\n` + token + `"}`, `{"msg":"sent\nontos_zyVPjbCi_[redacted]"}`},
		"JSON-escaped newline, JWT": {`{"msg":"got\n` + jwt + `"}`, `{"msg":"got\n[redacted-jwt]"}`},
		"after a word character":    {"x_" + token, "x_ontos_zyVPjbCi_[redacted]"},
		"followed by _":             {token + "_next", "ontos_zyVPjbCi_[redacted]_next"},
		"URL-encoded cookie":        {"h=Cookie%3A%20ontos_session%3D" + jwt, "h=Cookie%3A%20ontos_session%3D[redacted]"},
		"lower-case %3d":            {"h=ontos_session%3d" + jwt, "h=ontos_session%3d[redacted]"},
		"URL-encoded opaque cookie": {"h=ontos_session%3Dopaque0session0value", "h=ontos_session%3D[redacted]"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			p := write(t, dir, "r_1/world-0001/logs/app.log", c.line+"\n")
			code, _, manifest := scan(t, dir)
			if code != 0 {
				t.Fatalf("run = %d; want 0\n%s", code, manifest)
			}
			if got := read(t, p); got != c.want+"\n" {
				t.Fatalf("got  %q\nwant %q", got, c.want+"\n")
			}
			if !strings.Contains(manifest, "app.log:1 redacted ") {
				t.Fatalf("not reported:\n%s", manifest)
			}
		})
	}
}

// What the rules cannot see in place, a decoded copy of the line shows, and
// the file is refused rather than published.
func TestRefusesWhatIsStillThereOnceDecoded(t *testing.T) {
	cases := []struct{ kind, line string }{
		{"encoded ontology API token", "t=ontos%5FzyVPjbCi%5F" + tokenSecret},
		{"encoded session token (JWT)", `{"t":"ey\u004a` + strings.TrimPrefix(jwt, "eyJ") + `"}`},
		{"encoded AWS access key", "k=%41" + strings.TrimPrefix(awsKey, "A")},
		{"encoded Slack webhook URL", `{"url":"https:\/\/hooks.slack` + `.com\/services\/T0000\/B0000\/` + strings.Repeat("X", 24) + `"}`},
	}
	for _, c := range cases {
		t.Run(c.kind, func(t *testing.T) {
			dir := t.TempDir()
			write(t, dir, "r_1/world-0001/logs/app.log", "boot\n"+c.line+"\n")
			code, out, manifest := scan(t, dir)
			if code != 1 {
				t.Fatalf("run = %d; want 1\n%s", code, manifest)
			}
			if !strings.Contains(manifest, "app.log:2 REFUSED "+c.kind+"\n") {
				t.Fatalf("manifest lacks the refusal:\n%s", manifest)
			}
			if !strings.Contains(out, "::error file=r_1/world-0001/logs/app.log,line=2::"+c.kind+"\n") {
				t.Fatalf("no annotation:\n%s", out)
			}
		})
	}
}

func TestRefusesSecretsThatShouldNeverBeInABundle(t *testing.T) {
	cases := []struct{ name, kind, content string }{
		{"RSA private key", "private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n"},
		{"PGP private key", "private key", "-----BEGIN PGP " + "PRIVATE KEY BLOCK-----\nlQOYBF\n"},
		{"GitHub token, 36 characters", "GitHub token", "GITHUB_TOKEN=gh" + "s_" + strings.Repeat("a", 36) + "\n"},
		{"GitHub installation token", "GitHub token", installationToken + "\n"},
		{"GitHub installation token in the environment", "GitHub token", "GITHUB_TOKEN=" + installationToken + "\n"},
		{"GitHub installation token in a header", "GitHub token", "Authorization: token " + installationToken + "\n"},
		{"GitHub token followed by _", "GitHub token", "gh" + "p_" + strings.Repeat("Z", 36) + "_next\n"},
		{"GitHub fine-grained token", "GitHub token", "github" + "_pat_11ABCDEFG0" + strings.Repeat("x", 12) + "_" + strings.Repeat("Y", 59) + "\n"},
		{"AWS access key", "AWS access key", awsKey + "\n"},
		{"AWS temporary key", "AWS access key", "AS" + "IA" + "ABCDEFGHIJKLMNOP\n"},
		{"Slack bot token", "Slack token", "xox" + "b-123456789012-abcdef\n"},
		{"Slack app token", "Slack token", "xa" + "pp-1-A0123456789-1234567890123-" + strings.Repeat("f", 32) + "\n"},
		{"Slack webhook URL", "Slack webhook URL", "POST https://hooks.slack" + ".com/services/T0000/B0000/" + strings.Repeat("X", 24) + "\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			write(t, dir, "r_1/world-0001/logs/worker-a.log", c.content)
			code, out, manifest := scan(t, dir)
			if code != 1 {
				t.Fatalf("run = %d; want 1\n%s", code, manifest)
			}
			if !strings.Contains(manifest, "r_1/world-0001/logs/worker-a.log:1 REFUSED "+c.kind+"\n") {
				t.Fatalf("manifest lacks the refusal:\n%s", manifest)
			}
			if !strings.Contains(out, "::error file=r_1/world-0001/logs/worker-a.log,line=1::"+c.kind+"\n") {
				t.Fatalf("no annotation:\n%s", out)
			}
			// Never the value, in the manifest or the log.
			value := strings.TrimSpace(strings.SplitN(c.content, "\n", 2)[0])
			value = value[strings.LastIndexAny(value, " =")+1:]
			for _, text := range []string{manifest, out} {
				if strings.Contains(text, value) {
					t.Fatalf("the value was listed or printed:\n%s", text)
				}
			}
		})
	}
}

// Near misses stay as they were: a secret's shape, not its neighbourhood,
// makes a finding.
func TestLeavesWhatOnlyLooksLikeASecret(t *testing.T) {
	content := strings.Join([]string{
		"API token 0: ontos_zyVPjbCi…",
		"set-cookie: ontos_session=; Path=/; Max-Age=0",
		"ontos_pending_signout=1",
		"header only: eyJhbGciOiJIUzI1NiJ9",
		"region: ASIA-PACIFIC",
		"short: gh" + "p_" + strings.Repeat("a", 35),
		"Basic settings saved",
		`progress 100% done, 5%zz off, C:\q\path, \u12, %4`,
		`{"msg":"quoted \"ontos\" and a tab\tthere"}`,
	}, "\n") + "\n"
	dir := t.TempDir()
	p := write(t, dir, "r_1/world-0001/logs/app.log", content)
	code, _, manifest := scan(t, dir)
	if code != 0 {
		t.Fatalf("run = %d; want 0\n%s", code, manifest)
	}
	if read(t, p) != content {
		t.Fatalf("changed:\n%s", read(t, p))
	}
	if !strings.Contains(manifest, "Nothing redacted or refused.") {
		t.Fatalf("manifest:\n%s", manifest)
	}
}

// Refusals are judged on the line as it was read: the cookie redaction would
// otherwise take the key with it.
func TestARedactionNeverHidesARefusal(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "r_1/world-0001/logs/app.log", "cookie: ontos_session="+awsKey+"\n")
	code, _, manifest := scan(t, dir)
	if code != 1 {
		t.Fatalf("run = %d; want 1\n%s", code, manifest)
	}
	if !strings.Contains(manifest, "app.log:1 REFUSED AWS access key\n") {
		t.Fatalf("manifest:\n%s", manifest)
	}
}

// The cookie rule runs before the JWT rule, so a session cookie is redacted,
// and reported, as a cookie whatever its value.
func TestACookieIsRedactedAsACookie(t *testing.T) {
	dir := t.TempDir()
	p := write(t, dir, "r_1/world-0001/logs/app.log", "cookie: ontos_session="+jwt+"; Path=/\n")
	code, _, manifest := scan(t, dir)
	if code != 0 {
		t.Fatalf("run = %d; want 0", code)
	}
	if got := read(t, p); got != "cookie: ontos_session=[redacted]; Path=/\n" {
		t.Fatalf("got %q", got)
	}
	if !strings.Contains(manifest, "app.log:1 redacted session cookie\n") || strings.Contains(manifest, "JWT") {
		t.Fatalf("manifest:\n%s", manifest)
	}
}

func TestKeepsEachLineEnding(t *testing.T) {
	cases := map[string]struct{ in, want string }{
		"CRLF":                 {"boot\r\nBearer " + token + "\r\ncookie: ontos_session=" + jwt + "\r\nend\r\n", "boot\r\nBearer ontos_zyVPjbCi_[redacted]\r\ncookie: ontos_session=[redacted]\r\nend\r\n"},
		"LF, no final newline": {"boot\nBearer " + token, "boot\nBearer ontos_zyVPjbCi_[redacted]"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			p := write(t, dir, "r_1/app.log", c.in)
			if code, _, manifest := scan(t, dir); code != 0 {
				t.Fatalf("run = %d; want 0\n%s", code, manifest)
			}
			if got := read(t, p); got != c.want {
				t.Fatalf("got %q\nwant %q", got, c.want)
			}
		})
	}
}

func TestLeavesACleanBundleAsItWas(t *testing.T) {
	dir := t.TempDir()
	history := `{"t_ns":1,"process":0,"type":"invoke","f":"sync","key":"mapping/5","op_id":4}` + "\n"
	p := write(t, dir, "r_2/world-0001/history.jsonl", history)
	code, out, manifest := scan(t, dir)
	if code != 0 {
		t.Fatalf("run = %d; want 0", code)
	}
	if read(t, p) != history {
		t.Fatal("a clean file was rewritten")
	}
	if !strings.Contains(manifest, "1 file(s) scanned") || !strings.Contains(manifest, "Nothing redacted or refused.") {
		t.Fatalf("manifest: %s", manifest)
	}
	if strings.Contains(out, "::error") {
		t.Fatalf("annotation for a clean bundle:\n%s", out)
	}
}

// A second scan finds its own redactions, the cookie's among them, and must
// neither rewrite nor report them.
func TestScanningTwiceChangesAndReportsNothingMore(t *testing.T) {
	dir := t.TempDir()
	p := write(t, dir, "r_3/app.log", "Bearer "+token+"\ncookie: ontos_session="+jwt+"\n"+
		"h=ontos_session%3D"+jwt+"\nAuthorization: Basic "+basicValue+"\nx "+jwt+"\n")
	if code, _, manifest := scan(t, dir); code != 0 {
		t.Fatalf("first run = %d\n%s", code, manifest)
	}
	once := read(t, p)
	code, _, manifest := scan(t, dir)
	if code != 0 {
		t.Fatalf("second run = %d\n%s", code, manifest)
	}
	if read(t, p) != once {
		t.Fatalf("a second scan changed the file again:\n%s\nthen\n%s", once, read(t, p))
	}
	// The first scan's manifest is not scanned as a bundle file.
	if !strings.Contains(manifest, "1 file(s) scanned") || !strings.Contains(manifest, "Nothing redacted or refused.") {
		t.Fatalf("a second scan reported again:\n%s", manifest)
	}
}

// The printed manifest is the written one, and each refusal, never a
// redaction, is an annotation.
func TestPrintsTheManifestAndAnnotatesEachRefusal(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "r_1/world-0001/logs/app.log", "Bearer "+token+"\n")
	write(t, dir, "r_1/world-0001/logs/worker-b.log", "ok\nk="+awsKey+"\n")
	code, out, manifest := scan(t, dir)
	if code != 1 {
		t.Fatalf("run = %d; want 1", code)
	}
	if !strings.HasPrefix(out, manifest) {
		t.Fatalf("printed:\n%s\nwritten:\n%s", out, manifest)
	}
	if strings.Count(out, "::error ") != 1 || !strings.Contains(out, "::error file=r_1/world-0001/logs/worker-b.log,line=2::AWS access key\n") {
		t.Fatalf("annotations:\n%s", out)
	}
	if !strings.Contains(out, "bundlescan: 2 file(s), 1 redacted, 1 refused") {
		t.Fatalf("summary:\n%s", out)
	}
}

func TestAnnotationsAreEscapedAndCarryNoLineForAFile(t *testing.T) {
	got := annotation(finding{path: "r_1/a,b:c.log", line: 3, kind: "50% sure\r\nnext", refused: true})
	if want := "::error file=r_1/a%2Cb%3Ac.log,line=3::50%25 sure%0D%0Anext"; got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
	got = annotation(finding{path: "r_1/app.log", kind: "not a regular file: symbolic link", refused: true})
	if want := "::error file=r_1/app.log::not a regular file: symbolic link"; got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

// readOnly makes p read-only, or skips the test where the OS still lets this
// process write it, as it does root.
func readOnly(t *testing.T, p string) {
	t.Helper()
	if err := os.Chmod(p, 0o444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(p, 0o644) })
	if f, err := os.OpenFile(p, os.O_WRONLY, 0); err == nil {
		f.Close()
		t.Skip("this OS lets the test write a file it made read-only")
	}
}

// What cannot be read is not scanned, so it is refused: a file, or a
// directory that cannot be listed.
func TestRefusesWhatItCannotRead(t *testing.T) {
	t.Run("file", func(t *testing.T) {
		dir := t.TempDir()
		p := write(t, dir, "r_1/world-0001/logs/app.log", "Bearer "+token+"\n")
		if err := os.Chmod(p, 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(p, 0o644) })
		if _, err := os.ReadFile(p); err == nil {
			t.Skip("this OS lets the test read a file it made unreadable")
		}
		code, out, manifest := scan(t, dir)
		if code != 1 {
			t.Fatalf("run = %d; want 1\n%s", code, manifest)
		}
		if !strings.Contains(manifest, "r_1/world-0001/logs/app.log:0 REFUSED unreadable: ") {
			t.Fatalf("manifest:\n%s", manifest)
		}
		if !strings.Contains(out, "::error file=r_1/world-0001/logs/app.log::unreadable") {
			t.Fatalf("annotation:\n%s", out)
		}
	})
	t.Run("directory", func(t *testing.T) {
		dir := t.TempDir()
		write(t, dir, "r_1/world-0001/logs/app.log", "Bearer "+token+"\n")
		logs := filepath.Join(dir, "r_1", "world-0001", "logs")
		if err := os.Chmod(logs, 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(logs, 0o755) })
		if _, err := os.ReadDir(logs); err == nil {
			t.Skip("this OS lets the test list a directory it made unreadable")
		}
		code, _, manifest := scan(t, dir)
		if code != 1 {
			t.Fatalf("run = %d; want 1\n%s", code, manifest)
		}
		if !strings.Contains(manifest, "r_1/world-0001/logs:0 REFUSED unreadable: ") {
			t.Fatalf("manifest:\n%s", manifest)
		}
	})
}

// A file read but not written back still holds what needed redacting, so each
// such line is refused as unwritable. A read-only file with nothing to redact
// is fine.
func TestRefusesAFileItCannotWriteBack(t *testing.T) {
	dir := t.TempDir()
	p := write(t, dir, "r_1/world-0001/logs/app.log", "boot\nBearer "+token+"\n")
	clean := write(t, dir, "r_1/world-0001/driver.log", "ok\n")
	readOnly(t, p)
	readOnly(t, clean)
	code, _, manifest := scan(t, dir)
	if code != 1 {
		t.Fatalf("run = %d; want 1\n%s", code, manifest)
	}
	if !strings.Contains(manifest, "r_1/world-0001/logs/app.log:2 REFUSED unwritable: ontology API token not redacted (") {
		t.Fatalf("manifest:\n%s", manifest)
	}
	if strings.Contains(manifest, "unreadable") || strings.Contains(manifest, "driver.log") || strings.Contains(manifest, tokenSecret) {
		t.Fatalf("manifest:\n%s", manifest)
	}
}

// The upload follows links, so a link would publish whatever it points to,
// unscanned. It is refused and never followed.
func TestRefusesALinkAndNeverFollowsIt(t *testing.T) {
	outside := t.TempDir()
	target := write(t, outside, "secret.log", "Bearer "+token+"\n")
	dir := t.TempDir()
	write(t, dir, "r_1/world-0001/verdict.json", "{}\n")
	link := filepath.Join(dir, "r_1", "world-0001", "app.log")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("this OS will not let the test make a symbolic link: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "r_1", "elsewhere")); err != nil {
		t.Fatal(err)
	}
	// A link where the manifest goes is replaced, not written through.
	notes := write(t, outside, "notes.txt", "keep me\n")
	if err := os.Symlink(notes, filepath.Join(dir, Manifest)); err != nil {
		t.Fatal(err)
	}
	code, out, manifest := scan(t, dir)
	if code != 1 {
		t.Fatalf("run = %d; want 1\n%s", code, manifest)
	}
	for _, want := range []string{
		"r_1/elsewhere:0 REFUSED not a regular file: symbolic link\n",
		"r_1/world-0001/app.log:0 REFUSED not a regular file: symbolic link\n",
		"1 file(s) scanned",
	} {
		if !strings.Contains(manifest, want) {
			t.Fatalf("manifest lacks %q:\n%s", want, manifest)
		}
	}
	if !strings.Contains(out, "::error file=r_1/world-0001/app.log::not a regular file: symbolic link\n") {
		t.Fatalf("annotation:\n%s", out)
	}
	if read(t, target) != "Bearer "+token+"\n" {
		t.Fatal("the link was followed: its target was rewritten")
	}
	if read(t, notes) != "keep me\n" {
		t.Fatal("the manifest was written through a link")
	}
	if info, err := os.Lstat(filepath.Join(dir, Manifest)); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("the manifest is not a regular file: %v, %v", info, err)
	}
	// Nor is a link given as the directory walked.
	root := filepath.Join(t.TempDir(), "bundles")
	if err := os.Symlink(dir, root); err != nil {
		t.Fatal(err)
	}
	if _, err := run(root, io.Discard); err == nil {
		t.Fatal("want an error for a directory given as a link")
	}
}

func TestRefusesADirectoryThatIsNotThere(t *testing.T) {
	if _, err := run(filepath.Join(t.TempDir(), "missing"), io.Discard); err == nil {
		t.Fatal("want an error for a missing directory")
	}
}
