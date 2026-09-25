/**
 * Document history for undo and redo. Each entry is a serialized snapshot,
 * so restoring never shares objects with the live document.
 * @module editor/ui/history
 */

/** Bounded undo and redo stacks of document snapshots. */
export class History {
  /** @param {number} [limit=200] */
  constructor(limit = 200) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.current = null;
  }

  /**
   * Start from a document without recording an undo step.
   * @param {any} doc
   */
  reset(doc) {
    this.past = [];
    this.future = [];
    this.current = JSON.stringify(doc);
  }

  /**
   * Record the document after a change. Identical snapshots are ignored.
   * @param {any} doc
   * @returns {boolean} whether a step was recorded
   */
  push(doc) {
    const snap = JSON.stringify(doc);
    if (snap === this.current) return false;
    if (this.current != null) this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = snap;
    this.future = [];
    return true;
  }

  /** @returns {any|null} the previous document, or null */
  undo() {
    if (!this.past.length) return null;
    this.future.push(this.current);
    this.current = this.past.pop();
    return JSON.parse(this.current);
  }

  /** @returns {any|null} the next document, or null */
  redo() {
    if (!this.future.length) return null;
    this.past.push(this.current);
    this.current = this.future.pop();
    return JSON.parse(this.current);
  }

  /** @returns {boolean} */
  get canUndo() {
    return this.past.length > 0;
  }

  /** @returns {boolean} */
  get canRedo() {
    return this.future.length > 0;
  }
}
