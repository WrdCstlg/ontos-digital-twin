import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, LogIn, X } from 'lucide-react';
import { LOGIN_PATH } from '@/const';

interface AuthNoticeProps {
  /** Error message from a failed mutation, if any */
  message: string | null;
  /** Whether the viewer is signed in (from useAuth) */
  isAuthenticated: boolean;
  onDismiss: () => void;
}

/**
 * Inline, dismissible notice shown when a write mutation fails. Unauthenticated
 * viewers get a sign-in CTA linking LOGIN_PATH; others get the raw error.
 */
export function AuthNotice({ message, isAuthenticated, onDismiss }: AuthNoticeProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-3 rounded-lg border border-risk/30 bg-risk/10 px-3.5 py-2.5"
          role="alert"
        >
          <CircleAlert className="size-4 shrink-0 text-risk" />
          <p className="flex-1 text-[13px] text-text-secondary">
            {isAuthenticated ? (
              <>
                Action failed: <span className="font-mono text-[12px] text-risk">{message}</span>
              </>
            ) : (
              'This action writes to the workspace. Sign in to create connectors, save mappings, or run syncs.'
            )}
          </p>
          {!isAuthenticated && (
            <Link
              to={LOGIN_PATH}
              className="inline-flex items-center gap-1.5 rounded-md bg-iris px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-iris-bright"
            >
              <LogIn className="size-3.5" />
              Sign in
            </Link>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
          >
            <X className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
