import type { ConnectionStatus } from '../types';

const klass: Record<ConnectionStatus, string> = {
  idle: 'panel-status panel-status-idle',
  connecting: 'panel-status panel-status-connecting',
  connected: 'panel-status panel-status-live',
  reconnecting: 'panel-status panel-status-connecting',
  disconnected: 'panel-status panel-status-idle',
  error: 'panel-status panel-status-error',
};

const labels: Record<ConnectionStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  connected: 'Live',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function StatusPill({ status }: { status: ConnectionStatus }) {
  return (
    <span className={klass[status]}>
      <span className="dot" />
      {labels[status]}
    </span>
  );
}
