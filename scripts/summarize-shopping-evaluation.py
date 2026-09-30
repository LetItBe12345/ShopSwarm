#!/usr/bin/env python3
"""Summarize recorded CLI runs; evidence review stays manual."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
args = parser.parse_args()
review_path = args.directory / 'review.json'
reviews = json.loads(review_path.read_text()) if review_path.exists() else {}
runs = []
for path in sorted(args.directory.glob('*/run-metadata.json')):
    folder = path.parent
    metadata = json.loads(path.read_text())
    usage_path = folder / 'usage.json'
    usage = json.loads(usage_path.read_text()) if usage_path.exists() else {}
    plugins = json.loads((folder / 'plugin-results.json').read_text())
    source_metrics = {}
    reports = []
    errors = []
    for result in plugins:
        value = result.get('value', {})
        try:
            params = json.loads(result.get('arguments') or '{}')
        except (TypeError, ValueError):
            params = {}
        handle = params.get('sessionId') or value.get('sessionId') or params.get('continuationId') or value.get('handoff', {}).get('continuationId')
        if handle and value.get('metrics'):
            source_metrics[handle] = value['metrics']
        if value.get('report'):
            reports.append({'outcome': value['report'].get('outcome'), 'summary': value['report'].get('summary'), 'source': value.get('pageUrl')})
        if result.get('isError') or value.get('status') in {'failed', 'blocked'}:
            errors.append({'tool': result['tool'], 'reason': value.get('reasonCode') or value.get('raw'), 'detail': value.get('reason')})
    jev = {}
    for field in ['actionDecisionCalls', 'actionDecisionDurationMs', 'jevInputTokens', 'jevOutputTokens']:
        values = [metric.get(field) for metric in source_metrics.values()]
        jev[field] = None if any(value is None for value in values) else sum(values)
    timings = []
    for session in metadata.get('recoveredSessionIds', []):
        file = folder / (session + '.jsonl')
        if not file.exists():
            continue
        starts = {}
        for line in file.read_text().splitlines():
            record = json.loads(line)
            data = record.get('data', {})
            key = (data.get('turn'), data.get('step'))
            if record.get('type') == 'step/start':
                starts[key] = record['time']
            if record.get('type') == 'step/end' and key in starts:
                timings.append({'session': session, 'turn': key[0], 'step': key[1], 'elapsedMs': record['time'] - starts[key]})
    runs.append({'run': folder.name, 'mode': metadata.get('evaluationMode'), 'elapsedMs': metadata['elapsedMs'],
                 'exitCode': metadata['exitCode'], 'dshUsage': usage.get('dshAllSessions'), 'models': usage.get('modelSources'),
                 'jevUsage': jev, 'pluginReports': reports, 'pluginErrors': errors,
                 'longestSteps': sorted(timings, key=lambda item: item['elapsedMs'], reverse=True)[:3],
                 'sessionsAfter': metadata['sessionsAfter'], 'focusChanges': metadata['focusChanges'],
                 'review': reviews.get(folder.name, {'reviewed': False})})
output = args.directory / 'summary.json'
output.write_text(json.dumps({'runs': runs, 'semanticAssessment': 'manual; CLI completion is not task success'}, ensure_ascii=False, indent=2))
output.chmod(0o600)
print(json.dumps({'completedRuns': len(runs), 'reviewedRuns': sum(run['review'].get('reviewed', False) for run in runs), 'output': str(output)}, ensure_ascii=False))
