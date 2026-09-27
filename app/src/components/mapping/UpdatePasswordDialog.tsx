import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface UpdatePasswordDialogProps {
  /** The SQL connector whose password to enter again; closed when null. */
  connector: { id: number; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

/**
 * Enters a SQL connector's password again: when the stored one can no longer
 * be read (the key that sealed it changed), or it changed at the source. The
 * connector and its mappings stay as they are.
 */
export function UpdatePasswordDialog({ connector, onOpenChange, onUpdated }: UpdatePasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const update = trpc.mapping.setConnectorPassword.useMutation({
    onSuccess: async () => {
      await utils.mapping.listConnectors.invalidate();
      setPassword('');
      onUpdated();
      onOpenChange(false);
    },
    onError: (err) => setError(err.message),
  });

  const close = (open: boolean) => {
    if (!open) {
      setPassword('');
      setError(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={connector !== null} onOpenChange={close}>
      <DialogContent className="border-border-hairline bg-bg-panel sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-primary">
            <KeyRound className="size-4" /> Update password
          </DialogTitle>
          <DialogDescription className="text-text-secondary">
            Enter the database password for {connector?.name ?? 'this connector'}. It is sealed before it is stored, and never shown again.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!connector || !password) return;
            setError(null);
            update.mutate({ connectorId: connector.id, password });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="connector-password" className="text-text-secondary">
              Password
            </Label>
            <Input
              id="connector-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-border-hairline bg-bg-inset font-mono text-[12.5px]"
            />
          </div>
          {error && (
            <div role="alert" className="rounded-md border border-risk/30 bg-risk/10 px-3 py-2 text-[12.5px] text-risk">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => close(false)}
              className="rounded-md border border-border-hairline px-3 py-1.5 text-[12.5px] text-text-secondary hover:bg-bg-panel-raised"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password || update.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-iris px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-60"
            >
              {update.isPending && <Loader2 className="size-3.5 animate-spin" />} Save password
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
