// ===== Command runtime bridge =====
// Bridges pure domain commands to the live browser state/undo layer.

import { worldBook, setEntries, snapshotForUndo } from '../state.js';
import { applyWorldBookCommand, commandWouldChange, entriesOf } from './worldbook-commands.js';

export function runWorldBookCommand(command, options = {}) {
  if (!worldBook) throw new Error('world book is not loaded');

  const label = options.label || '修改世界书';
  const useUndo = options.undo !== false;

  if (!commandWouldChange(worldBook, command)) {
    return applyWorldBookCommand(worldBook, command);
  }

  if (useUndo) snapshotForUndo(label);
  const result = applyWorldBookCommand(worldBook, command);

  if (result.structural) {
    setEntries(entriesOf(worldBook));
  }

  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('wbe:command', {
      detail: { label, command, result }
    }));
  }

  return result;
}
