/**
 * In-Memory Policy Snapshot & Version Store (Phase 8).
 *
 * Provides a lightweight session registry for caching historical snapshots
 * of vendor policies to compute timeline progressions.
 */

class SnapshotStore {
  constructor() {
    this._snapshots = new Map(); // vendorKey -> Array of { versionLabel, timestamp, policyText, analysis }
  }

  /**
   * Records a policy version snapshot for a given vendor.
   *
   * @param {string} vendorName
   * @param {Object} snapshot - { versionLabel, policyText, analysis }
   * @returns {Object} Saved snapshot
   */
  saveSnapshot(vendorName = "", snapshot = {}) {
    const key = String(vendorName).trim().toLowerCase() || "default";
    if (!this._snapshots.has(key)) {
      this._snapshots.set(key, []);
    }

    const entry = {
      id: `${key}-${Date.now()}`,
      vendorName,
      versionLabel: snapshot.versionLabel || `v${this._snapshots.get(key).length + 1}`,
      timestamp: snapshot.timestamp || new Date().toISOString(),
      policyText: snapshot.policyText || "",
      analysis: snapshot.analysis || null
    };

    this._snapshots.get(key).push(entry);
    return entry;
  }

  /**
   * Retrieves all recorded snapshots for a vendor ordered by time.
   *
   * @param {string} vendorName
   * @returns {Array<Object>}
   */
  getSnapshots(vendorName = "") {
    const key = String(vendorName).trim().toLowerCase();
    return this._snapshots.get(key) || [];
  }

  /**
   * Clears snapshots for a vendor or all vendors.
   *
   * @param {string} [vendorName]
   */
  clear(vendorName) {
    if (vendorName) {
      this._snapshots.delete(String(vendorName).trim().toLowerCase());
    } else {
      this._snapshots.clear();
    }
  }
}

export const snapshotStore = new SnapshotStore();
