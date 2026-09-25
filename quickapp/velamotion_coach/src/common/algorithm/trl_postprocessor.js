import {
  CLASS_NAMES,
  WINDOW_SEC,
  STEP_SEC,
  DEMO_MIN_SEGMENT_SEC,
  DEMO_SHORT_GAP_SEC,
  CONF_MIN,
  AVG_SMOOTH_SIZE,
  MEDIAN_SIZE,
} from './config.js';

// The Git baseline decodes the whole session with Viterbi on every update.
// Keep its exact transition scores and centered smoothing, but freeze labels
// once they are this far behind the live edge so runtime work stays bounded.
const VITERBI_FIXED_LAG = 32;

function buildLogTransitions(nStates) {
  const trans = [];
  for (let i = 0; i < nStates; i++) {
    trans[i] = new Array(nStates).fill(0.001);
    trans[i][i] = 0.97;
  }
  for (let i = 1; i < nStates; i++) {
    trans[0][i] = 0.01;
    trans[i][0] = 0.05;
  }
  return trans.map((row) => {
    const sum = row.reduce((left, right) => left + right, 0) || 1;
    return row.map((value) => Math.log(value / sum + 1e-10));
  });
}

const LOG_TRANSITIONS = buildLogTransitions(CLASS_NAMES.length);
const LOG_INITIAL = Math.log(1 / CLASS_NAMES.length);

function argMax(values) {
  let idx = 0;
  let best = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > best) {
      best = values[i];
      idx = i;
    }
  }
  return idx;
}

function median(values) {
  const arr = values.slice().sort((a, b) => a - b);
  return arr[Math.floor(arr.length / 2)];
}

export class TemporalRecordLayer {
  constructor() {
    this.reset();
  }

  reset() {
    this.timesSec = [];
    this.probs = [];
    this.averaged = [];
    this.smoothed = [];
    this.path = [];
    this.rawSegments = [];
    this.segmentRecords = [];
    this.segments = [];
    this.activeRawSegment = null;
    this.tailSegmentRecord = null;
    this.viterbiScores = [];
    this.backPointers = [];
    this.segmentCommittedCount = 0;
    this.committedStatsByClass = {};
    this.stableSegmentState = this.captureSegmentState(-1);
  }

  updateSmoothedTail() {
    const count = this.probs.length;
    const averageHalf = Math.floor(AVG_SMOOTH_SIZE / 2);
    const medianHalf = Math.floor(MEDIAN_SIZE / 2);
    const averageStart = Math.max(0, count - 1 - averageHalf);
    const nClass = this.probs[count - 1].length;

    for (let t = averageStart; t < count; t++) {
      const row = new Array(nClass).fill(0);
      for (let c = 0; c < nClass; c++) {
        for (let k = -averageHalf; k <= averageHalf; k++) {
          const index = Math.max(0, Math.min(count - 1, t + k));
          row[c] += this.probs[index][c];
        }
        row[c] /= AVG_SMOOTH_SIZE;
      }
      this.averaged[t] = row;
    }
    this.averaged.length = count;

    const smoothedStart = Math.max(0, averageStart - medianHalf);
    for (let t = smoothedStart; t < count; t++) {
      const row = new Array(nClass);
      for (let c = 0; c < nClass; c++) {
        const values = [];
        for (let k = -medianHalf; k <= medianHalf; k++) {
          const index = Math.max(0, Math.min(count - 1, t + k));
          values.push(this.averaged[index][c]);
        }
        row[c] = median(values);
      }
      this.smoothed[t] = row;
    }
    this.smoothed.length = count;
    return smoothedStart;
  }

  updateViterbiTail(startIndex) {
    const count = this.smoothed.length;
    const nStates = CLASS_NAMES.length;
    let start = Math.max(0, startIndex);
    if (start === 0) {
      this.viterbiScores[0] = new Array(nStates);
      this.backPointers[0] = new Array(nStates).fill(0);
      for (let state = 0; state < nStates; state++) {
        this.viterbiScores[0][state] = LOG_INITIAL
          + Math.log(this.smoothed[0][state] + 1e-10);
      }
      start = 1;
    }

    for (let t = start; t < count; t++) {
      const scores = new Array(nStates);
      const pointers = new Array(nStates);
      for (let state = 0; state < nStates; state++) {
        let best = -Infinity;
        let bestPrevious = 0;
        for (let previous = 0; previous < nStates; previous++) {
          const score = this.viterbiScores[t - 1][previous]
            + LOG_TRANSITIONS[previous][state];
          if (score > best) {
            best = score;
            bestPrevious = previous;
          }
        }
        scores[state] = best + Math.log(this.smoothed[t][state] + 1e-10);
        pointers[state] = bestPrevious;
      }
      this.viterbiScores[t] = scores;
      this.backPointers[t] = pointers;
    }
    this.viterbiScores.length = count;
    this.backPointers.length = count;
  }

  decodeSuffix(startIndex) {
    const count = this.viterbiScores.length;
    if (!count || startIndex >= count) return [];
    const suffix = new Array(count - startIndex);
    let state = argMax(this.viterbiScores[count - 1]);
    for (let index = count - 1; index >= startIndex; index--) {
      suffix[index - startIndex] = state;
      if (index > 0) state = this.backPointers[index][state];
    }
    return suffix;
  }

  captureSegmentState(lastClass) {
    const rawTail = this.rawSegments.length
      ? this.rawSegments[this.rawSegments.length - 1]
      : null;
    const recordTail = this.segmentRecords.length
      ? this.segmentRecords[this.segmentRecords.length - 1]
      : null;
    return {
      rawLength: this.rawSegments.length,
      rawTail,
      rawTailValues: rawTail ? Object.assign({}, rawTail) : null,
      recordLength: this.segmentRecords.length,
      recordTail,
      recordTailVisible: recordTail ? recordTail.visible : false,
      recordTailVisibleIndex: recordTail ? recordTail.visibleIndex : -1,
      recordTailSegmentValues: recordTail ? Object.assign({}, recordTail.segment) : null,
      visibleLength: this.segments.length,
      visibleTail: this.segments.length ? this.segments[this.segments.length - 1] : null,
      activeRawSegment: this.activeRawSegment,
      tailSegmentRecord: this.tailSegmentRecord,
      lastClass,
    };
  }

  restoreSegmentState(snapshot) {
    this.rawSegments.length = snapshot.rawLength;
    if (snapshot.rawTail) {
      Object.assign(snapshot.rawTail, snapshot.rawTailValues);
      this.rawSegments[snapshot.rawLength - 1] = snapshot.rawTail;
    }
    this.segmentRecords.length = snapshot.recordLength;
    if (snapshot.recordTail) {
      snapshot.recordTail.visible = snapshot.recordTailVisible;
      snapshot.recordTail.visibleIndex = snapshot.recordTailVisibleIndex;
      Object.assign(snapshot.recordTail.segment, snapshot.recordTailSegmentValues);
      this.segmentRecords[snapshot.recordLength - 1] = snapshot.recordTail;
    }
    this.segments.length = snapshot.visibleLength;
    if (snapshot.visibleLength) {
      this.segments[snapshot.visibleLength - 1] = snapshot.visibleTail;
    }
    this.activeRawSegment = snapshot.activeRawSegment;
    this.tailSegmentRecord = snapshot.tailSegmentRecord;
  }

  rebuildSegmentTail(oldCommittedCount, targetCommittedCount, suffix) {
    this.restoreSegmentState(this.stableSegmentState);
    let previousClass = this.stableSegmentState.lastClass;
    const newlyCommitted = targetCommittedCount - oldCommittedCount;

    for (let offset = 0; offset < newlyCommitted; offset++) {
      const index = oldCommittedCount + offset;
      const cls = suffix[offset];
      const confidence = this.smoothed[index][cls] || 0;
      this.updateRawSegments(index, this.timesSec[index], cls, confidence, previousClass);
      this.committedStatsByClass[cls] = (this.committedStatsByClass[cls] || 0) + STEP_SEC;
      previousClass = cls;
    }
    this.segmentCommittedCount = targetCommittedCount;
    this.stableSegmentState = this.captureSegmentState(previousClass);

    for (let offset = newlyCommitted; offset < suffix.length; offset++) {
      const index = oldCommittedCount + offset;
      const cls = suffix[offset];
      const confidence = this.smoothed[index][cls] || 0;
      this.updateRawSegments(index, this.timesSec[index], cls, confidence, previousClass);
      previousClass = cls;
    }
  }

  statsFromCommittedAndTail(suffix, newlyCommitted) {
    const byClass = Object.assign({}, this.committedStatsByClass);
    for (let i = newlyCommitted; i < suffix.length; i++) {
      const cls = suffix[i];
      byClass[cls] = (byClass[cls] || 0) + STEP_SEC;
    }
    return { totalSec: this.probs.length * STEP_SEC, byClass };
  }

  segmentIsVisible(segment) {
    if (segment.confidence < CONF_MIN) return false;
    if (segment.isOngoing) {
      return segment.durationSec >= Math.min(2, DEMO_MIN_SEGMENT_SEC);
    }
    return segment.durationSec >= DEMO_MIN_SEGMENT_SEC;
  }

  syncVisibleSegment(record) {
    const visible = this.segmentIsVisible(record.segment);
    if (visible && !record.visible) {
      record.visible = true;
      record.visibleIndex = this.segments.length;
      this.segments.push(record.segment);
      return;
    }
    if (!visible && record.visible) {
      // Only the current segment or its immediate predecessor can change.
      // Under time-ordered input it is therefore always the visible tail.
      const lastIndex = this.segments.length - 1;
      if (lastIndex >= 0 && this.segments[lastIndex] === record.segment) {
        this.segments.pop();
      } else {
        // Keep correctness if a caller ever violates the monotonic-time
        // contract; this exceptional path is not used by sensor providers.
        this.segments.splice(record.visibleIndex, 1);
      }
      record.visible = false;
      record.visibleIndex = -1;
    }
  }

  refreshSegmentFromRaw(raw) {
    const record = raw.segmentRecord;
    const segment = record.segment;
    const rawConfidence = raw.confidenceSum / Math.max(1, raw.confidenceCount);
    if (raw.mergedIntoTail) {
      segment.endSec = Math.max(raw.mergeBaseEndSec, raw.endSec);
      segment.confidence = (raw.mergeBaseConfidence + rawConfidence) / 2;
      // mergeSameClassSegments intentionally keeps the first run's window
      // indices; retain that legacy behavior for saved-session compatibility.
    } else {
      segment.endSec = raw.endSec;
      segment.confidence = rawConfidence;
      segment.endWindowIdx = raw.endWindowIdx;
    }
    segment.durationSec = Math.max(0, segment.endSec - segment.startSec);
    segment.isOngoing = raw.isOngoing;
    this.syncVisibleSegment(record);
  }

  closeActiveRawSegment() {
    const raw = this.activeRawSegment;
    if (!raw) return;
    raw.isOngoing = false;
    this.refreshSegmentFromRaw(raw);
    this.activeRawSegment = null;
  }

  startRawSegment(windowIndex, centerTimeSec, cls, confidence) {
    const startSec = Math.max(0, centerTimeSec - WINDOW_SEC / 2);
    const endSec = Math.max(startSec, centerTimeSec + WINDOW_SEC / 2);
    const raw = {
      classIdx: cls,
      className: CLASS_NAMES[cls],
      startSec,
      endSec,
      durationSec: Math.max(0, endSec - startSec),
      confidenceSum: confidence,
      confidenceCount: 1,
      startWindowIdx: windowIndex,
      endWindowIdx: windowIndex,
      isOngoing: true,
      mergedIntoTail: false,
      mergeBaseEndSec: 0,
      mergeBaseConfidence: 0,
      segmentRecord: null,
    };
    this.rawSegments.push(raw);

    const tail = this.tailSegmentRecord;
    const gap = tail ? raw.startSec - tail.segment.endSec : Infinity;
    if (tail && tail.segment.classIdx === cls && gap < DEMO_SHORT_GAP_SEC) {
      raw.mergedIntoTail = true;
      raw.mergeBaseEndSec = tail.segment.endSec;
      raw.mergeBaseConfidence = tail.segment.confidence;
      raw.segmentRecord = tail;
    } else {
      const segment = {
        classIdx: cls,
        className: CLASS_NAMES[cls],
        startSec,
        endSec,
        durationSec: Math.max(0, endSec - startSec),
        confidence,
        startWindowIdx: windowIndex,
        endWindowIdx: windowIndex,
        isOngoing: true,
      };
      const record = { segment, visible: false, visibleIndex: -1 };

      // The legacy overlap resolver only ever changes the previous segment
      // and the new segment. Resolve that boundary once when the run starts.
      if (tail && segment.startSec < tail.segment.endSec) {
        const midpoint = (segment.startSec + tail.segment.endSec) / 2;
        tail.segment.endSec = Math.max(tail.segment.startSec, midpoint);
        tail.segment.durationSec = Math.max(
          0,
          tail.segment.endSec - tail.segment.startSec,
        );
        segment.startSec = Math.min(segment.endSec, midpoint);
        segment.durationSec = Math.max(0, segment.endSec - segment.startSec);
        this.syncVisibleSegment(tail);
      }

      this.segmentRecords.push(record);
      this.tailSegmentRecord = record;
      raw.segmentRecord = record;
    }

    this.activeRawSegment = raw;
    this.refreshSegmentFromRaw(raw);
  }

  extendActiveRawSegment(windowIndex, centerTimeSec, confidence) {
    const raw = this.activeRawSegment;
    if (!raw) return;
    raw.endSec = Math.max(raw.startSec, centerTimeSec + WINDOW_SEC / 2);
    raw.durationSec = Math.max(0, raw.endSec - raw.startSec);
    raw.endWindowIdx = windowIndex;
    raw.confidenceSum += confidence;
    raw.confidenceCount += 1;
    this.refreshSegmentFromRaw(raw);
  }

  updateRawSegments(windowIndex, centerTimeSec, cls, confidence, previousClass) {
    if (previousClass === cls) {
      if (cls > 0) {
        if (this.activeRawSegment) {
          this.extendActiveRawSegment(windowIndex, centerTimeSec, confidence);
        } else {
          this.startRawSegment(windowIndex, centerTimeSec, cls, confidence);
        }
      }
      return;
    }

    this.closeActiveRawSegment();
    if (cls > 0) this.startRawSegment(windowIndex, centerTimeSec, cls, confidence);
  }

  update(centerTimeSec, probs) {
    this.timesSec.push(centerTimeSec);
    this.probs.push(probs.slice());
    const smoothedStart = this.updateSmoothedTail();
    this.updateViterbiTail(smoothedStart);

    const count = this.probs.length;
    const oldCommittedCount = this.segmentCommittedCount;
    const targetCommittedCount = Math.max(0, count - VITERBI_FIXED_LAG);
    const suffix = this.decodeSuffix(oldCommittedCount);
    this.path.length = oldCommittedCount;
    for (let i = 0; i < suffix.length; i++) this.path.push(suffix[i]);

    const newlyCommitted = targetCommittedCount - oldCommittedCount;
    this.rebuildSegmentTail(oldCommittedCount, targetCommittedCount, suffix);
    const stats = this.statsFromCommittedAndTail(suffix, newlyCommitted);
    const cls = this.path[count - 1];
    const smoothed = this.smoothed[count - 1];
    const confidence = smoothed[cls] || 0;
    return {
      classIdx: cls,
      className: CLASS_NAMES[cls],
      confidence,
      probs: this.probs[this.probs.length - 1] || [],
      smoothedProbs: smoothed,
      decodedSeconds: count,
      // The visible array is maintained in place so a long session does not
      // copy every historical segment once per inference window. Treat it as
      // a read-only snapshot until the next update.
      segments: this.segments,
      stats,
    };
  }
}
