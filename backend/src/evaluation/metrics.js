/**
 * Evaluation Metrics Module for TOS Red Flag Scanner (Phase 9.5B).
 *
 * Implements pure deterministic mathematical metric equations for:
 * 1. Information Retrieval: Precision@K, Recall@K
 * 2. Multi-Class Classification: Precision, Recall, F1-Score, Macro-F1, Confusion Matrix
 *
 * Zero external dependencies. Complete protection against division by zero.
 */

/**
 * Calculates Precision@K for a ranked list of predicted IDs against ground-truth relevant IDs.
 *
 * Formula:
 *   Precision@K = |TopK(Predicted) ∩ Relevant| / K
 *
 * @param {Array<string>} predictedIds - Ordered list of predicted identifiers (highest rank first)
 * @param {Array<string>} groundTruthIds - Set of ground-truth relevant identifiers
 * @param {number} [k=5] - Rank cutoff threshold
 * @returns {number} Precision@K value in [0, 1]
 */
export function precisionAtK(predictedIds, groundTruthIds, k = 5) {
  if (!Number.isInteger(k) || k <= 0) {
    return 0;
  }
  if (!Array.isArray(predictedIds) || predictedIds.length === 0) {
    return 0;
  }
  if (!Array.isArray(groundTruthIds) || groundTruthIds.length === 0) {
    return 0;
  }

  const groundTruthSet = new Set(groundTruthIds.map(String));
  if (groundTruthSet.size === 0) {
    return 0;
  }

  // Slice top K and deduplicate
  const topK = predictedIds.slice(0, k).map(String);
  const uniqueTopK = new Set(topK);

  let hits = 0;
  for (const id of uniqueTopK) {
    if (groundTruthSet.has(id)) {
      hits += 1;
    }
  }

  const score = hits / k;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

/**
 * Calculates Recall@K for a ranked list of predicted IDs against ground-truth relevant IDs.
 *
 * Formula:
 *   Recall@K = |TopK(Predicted) ∩ Relevant| / |Relevant|
 *
 * @param {Array<string>} predictedIds - Ordered list of predicted identifiers (highest rank first)
 * @param {Array<string>} groundTruthIds - Set of ground-truth relevant identifiers
 * @param {number} [k=5] - Rank cutoff threshold
 * @returns {number} Recall@K value in [0, 1]
 */
export function recallAtK(predictedIds, groundTruthIds, k = 5) {
  if (!Number.isInteger(k) || k <= 0) {
    return 0;
  }
  if (!Array.isArray(predictedIds) || predictedIds.length === 0) {
    return 0;
  }
  if (!Array.isArray(groundTruthIds) || groundTruthIds.length === 0) {
    return 0;
  }

  const groundTruthSet = new Set(groundTruthIds.map(String));
  if (groundTruthSet.size === 0) {
    return 0;
  }

  const topK = predictedIds.slice(0, k).map(String);
  const uniqueTopK = new Set(topK);

  let hits = 0;
  for (const id of uniqueTopK) {
    if (groundTruthSet.has(id)) {
      hits += 1;
    }
  }

  const score = hits / groundTruthSet.size;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

/**
 * Builds a confusion matrix for categorical predictions against ground-truth labels.
 *
 * @param {Array<string>} predictions - Predicted class labels
 * @param {Array<string>} groundTruth - Ground-truth class labels
 * @param {Array<string>} [labels] - Canonical list of labels to include
 * @returns {Object} Confusion matrix structure with per-class TP, FP, FN, TN, and support
 */
export function confusionMatrix(predictions, groundTruth, labels) {
  const preds = Array.isArray(predictions) ? predictions.map(String) : [];
  const gts = Array.isArray(groundTruth) ? groundTruth.map(String) : [];

  const sampleCount = Math.min(preds.length, gts.length);

  // Discover all unique labels if not explicitly supplied
  const labelSet = Array.isArray(labels) && labels.length > 0
    ? new Set(labels.map(String))
    : new Set([...preds.slice(0, sampleCount), ...gts.slice(0, sampleCount)]);

  const classList = Array.from(labelSet);
  const matrix = {};

  for (const label of classList) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    let support = 0;

    for (let i = 0; i < sampleCount; i += 1) {
      const p = preds[i];
      const g = gts[i];

      const isPred = p === label;
      const isActual = g === label;

      if (isActual) support += 1;

      if (isPred && isActual) tp += 1;
      else if (isPred && !isActual) fp += 1;
      else if (!isPred && isActual) fn += 1;
      else tn += 1;
    }

    matrix[label] = { tp, fp, fn, tn, support };
  }

  return {
    sampleCount,
    classes: classList,
    perClass: matrix
  };
}

/**
 * Computes multi-class classification metrics: Precision, Recall, F1, and Macro-F1.
 *
 * Formulas:
 *   Precision_c = TP_c / (TP_c + FP_c)
 *   Recall_c    = TP_c / (TP_c + FN_c)
 *   F1_c        = 2 * Precision_c * Recall_c / (Precision_c + Recall_c)
 *   Macro-F1    = (1 / |C|) * Σ F1_c
 *
 * @param {Array<string>} predictions - Predicted class labels
 * @param {Array<string>} groundTruth - Ground-truth class labels
 * @param {Array<string>} [labels] - Canonical list of classes to evaluate
 * @returns {Object} Full classification metrics breakdown
 */
export function classificationMetrics(predictions, groundTruth, labels) {
  const preds = Array.isArray(predictions) ? predictions.map(String) : [];
  const gts = Array.isArray(groundTruth) ? groundTruth.map(String) : [];

  const sampleCount = Math.min(preds.length, gts.length);

  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      macroPrecision: 0,
      macroRecall: 0,
      macroF1: 0,
      classes: {},
      labels: []
    };
  }

  const cm = confusionMatrix(preds, gts, labels);
  const classList = cm.classes;
  const classMetrics = {};

  let sumPrecision = 0;
  let sumRecall = 0;
  let sumF1 = 0;
  let totalCorrect = 0;
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;

  for (const cls of classList) {
    const { tp, fp, fn, support } = cm.perClass[cls];

    const p = tp + fp > 0 ? tp / (tp + fp) : 0;
    const r = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;

    classMetrics[cls] = {
      precision: Number(p.toFixed(4)),
      recall: Number(r.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      support
    };

    sumPrecision += p;
    sumRecall += r;
    sumF1 += f1;
    totalTp += tp;
    totalFp += fp;
    totalFn += fn;
  }

  for (let i = 0; i < sampleCount; i += 1) {
    if (preds[i] === gts[i]) {
      totalCorrect += 1;
    }
  }

  const classCount = classList.length || 1;
  const macroP = sumPrecision / classCount;
  const macroR = sumRecall / classCount;
  const macroF1 = sumF1 / classCount;

  const microP = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 0;
  const microR = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 0;
  const microF1 = microP + microR > 0 ? (2 * microP * microR) / (microP + microR) : 0;
  const accuracy = totalCorrect / sampleCount;

  return {
    sampleCount,
    accuracy: Number(accuracy.toFixed(4)),
    precision: Number(microP.toFixed(4)),
    recall: Number(microR.toFixed(4)),
    f1: Number(microF1.toFixed(4)),
    macroPrecision: Number(macroP.toFixed(4)),
    macroRecall: Number(macroR.toFixed(4)),
    macroF1: Number(macroF1.toFixed(4)),
    classes: classMetrics,
    labels: classList
  };
}

/**
 * Computes Macro-F1 score directly across predicted and ground-truth label sequences.
 *
 * @param {Array<string>} predictions
 * @param {Array<string>} groundTruth
 * @param {Array<string>} [labels]
 * @returns {number} Macro-F1 score in [0, 1]
 */
export function macroF1(predictions, groundTruth, labels) {
  const result = classificationMetrics(predictions, groundTruth, labels);
  return result.macroF1;
}
