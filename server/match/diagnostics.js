export function recordAdminDiagnostic(match, event) {
  const entries = match.adminDiagnostics ||= [];
  const seq = match.adminDiagnosticSeq = (match.adminDiagnosticSeq || 0) + 1;
  entries.push({ at: Date.now(), seq, round: match.round, phase: match.phase, ...event });
  if (entries.length > 200) entries.splice(0, entries.length - 200);
}
