#!/usr/bin/env python3
"""Five real DSH CLI shopping tasks. Observe execution; do not drive the Agent."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', default='headless', help='Installed DSH profile for single-tool validation')
parser.add_argument('--prompt', help='Natural-language shopping task; sources chosen by DSH Agent')
parser.add_argument('--case', help='Run fixture cases by comma-separated ids; default runs all five')
parser.add_argument('--output', help='Private runtime output directory')
parser.add_argument('--compare', action='store_true', help='Paired runs: DSH direct browser versus current ShopSwarm, one round')
parser.add_argument('--chrome-profile', help='Add direct-browser Chrome named-profile reuse as third arm (read-only copy)')
args = parser.parse_args()
cases = json.loads((ROOT / 'tests/fixtures/shopping-live-cases.json').read_text())['cases']
if args.chrome_profile and (not args.compare or '/' in args.chrome_profile or '\\' in args.chrome_profile):
    parser.error('--chrome-profile requires --compare and a Chrome profile name, not a path')
if args.prompt:
    if args.case or args.compare:
        parser.error('--prompt cannot be combined with --case or --compare')
    cases = [{'id': 'task', 'name': 'User shopping task', 'url': '由 Agent 选择该任务的真实商品页面', 'task': args.prompt}]
if args.case:
    selected = set(args.case.split(','))
    if selected - {case['id'] for case in cases}:
        parser.error('unknown case')
    cases = [case for case in cases if case['id'] in selected]
env = os.environ.copy()
# Select installed tooling explicitly; never continue with a different version.
node_dir = Path('/home/jin/.local/share/mise/installs/node/24.21.0/bin')
if node_dir.is_dir():
    env['PATH'] = str(node_dir) + ':' + env.get('PATH', '')
for command, expected in [('node', 'v24.21.0'), ('pnpm', '11.7.0')]:
    actual = subprocess.check_output([command, '--version'], env=env, text=True).strip()
    if actual != expected:
        raise SystemExit(f'{command}: expected {expected}, got {actual}')
for name in list(env):
    if name.lower() in {'http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy', 'no_proxy', 'agent_browser_proxy', 'agent_browser_proxy_bypass'}:
        del env[name]
secrets = []
for line in (ROOT / '.env').read_text().splitlines() if (ROOT / '.env').exists() else []:
    if '=' in line and not line.lstrip().startswith('#'):
        name, value = line.split('=', 1)
        value = value.strip().strip('\"').strip("'")
        if ('KEY' in name or 'TOKEN' in name) and value:
            secrets.append(value)
for name, value in env.items():
    if ('KEY' in name or 'TOKEN' in name) and value:
        secrets.append(value)
def redact(text):
    for secret in secrets:
        text = text.replace(secret, '[REDACTED]')
    return text
def save(path, value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        file.write(redact(text))
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def focus():
    try:
        return subprocess.check_output(['xprop', '-root', '_NET_ACTIVE_WINDOW'], text=True, timeout=2).strip()
    except (OSError, subprocess.SubprocessError):
        return 'unavailable'
out = Path(args.output) if args.output else ROOT / 'runtime/subagent-evaluation' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
out.mkdir(parents=True, exist_ok=True, mode=0o700)
browser_env = env.copy()
for name in ['AGENT_BROWSER_PROFILE', 'AGENT_BROWSER_STATE', 'AGENT_BROWSER_SESSION_NAME', 'AGENT_BROWSER_ARGS', 'AGENT_BROWSER_EXTENSIONS', 'AGENT_BROWSER_PROVIDER', 'AGENT_BROWSER_CDP', 'AGENT_BROWSER_AUTO_CONNECT', 'AGENT_BROWSER_HEADED']:
    browser_env.pop(name, None)
empty_config = out / 'browser-empty.json'
save(empty_config, {})
browser_env['AGENT_BROWSER_CONFIG'] = str(empty_config.resolve())
def sessions():
    observations = []
    for socket_dir in [None, str(ROOT / 'runtime/shopswarm-browser')]:
        inspect_env = browser_env.copy()
        if socket_dir:
            inspect_env['AGENT_BROWSER_SOCKET_DIR'] = socket_dir
        try:
            result = json.loads(subprocess.check_output(['node', str(ROOT / 'node_modules/agent-browser/bin/agent-browser.js'), '--headed', 'false', '--auto-connect', 'false', '--json', 'session', 'list'], env=inspect_env, text=True, timeout=10))
            observations.append({'socketDir': socket_dir or 'default', 'result': result})
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            return {'unavailable': str(error), 'observations': observations}
    return {'success': all(item['result'].get('success') for item in observations),
            'data': {'sessions': sorted({session for item in observations for session in item['result'].get('data', {}).get('sessions', [])})},
            'observations': observations}
all_results = []
if args.compare:
    import shutil
    profile_root = Path.home() / '.dsh/profiles'
    template = profile_root / 'headless'
    modes = ['browser', 'shopswarm'] + (['browser-profile'] if args.chrome_profile else [])
    for mode in modes:
        target = profile_root / ('shopping-eval-' + mode)
        target.mkdir(parents=True, exist_ok=True)
        manifest = json.loads((template / 'package.json').read_text())
        manifest['name'] = 'dsh-profile-shopping-eval-' + mode
        if mode.startswith('browser'):
            manifest['dsh']['profile']['bundles'] = [name for name in manifest['dsh']['profile']['bundles'] if name != 'shopswarm']
            manifest['dependencies'] = {}
        save(target / 'package.json', manifest)
        for name in ['cordis.yml', 'cordis.patch.yml']:
            if (template / name).exists():
                shutil.copyfile(template / name, target / name)
        if not (target / 'node_modules').exists():
            (target / 'node_modules').symlink_to(template / 'node_modules', target_is_directory=True)
    # Adjacent paired runs, alternating which method goes first. No prior answers in prompt.
    cases = [dict(case, evaluationMode=mode) for index, case in enumerate(cases) for mode in (modes[index % len(modes):] + modes[:index % len(modes)])]
# Thomann is the smallest task; order does not change any case prompt or expected result.
if not args.compare:
    cases.sort(key=lambda case: case['id'] != 'thomann')
for case in cases:
    mode = case.get('evaluationMode', 'shopswarm')
    folder = out / (case['id'] + ('-' + mode if args.compare else ''))
    folder.mkdir(mode=0o700, exist_ok=False)
    prompt = (f"执行一次真实购物研究：{case['task']}\n起点：{case['url']}\n"
              "由 DSH Lead 同步委派一个来源 Subagent，等待它回传后汇总。先读 skills/shopping-research/SKILL.md。"
              "来源 Agent 使用当前单工具 shopswarm_browser，给 Jev 一个具体浏览子目标；工具返回后按真实观察判断。"
              "若需要 fallback，使用返回的 cli.executable、cli.args、cli.env 通过 agent-browser CLI 操作同一持久 headless 会话，不另开浏览器。"
              "不要把 Jev DONE 当成购物完成。按用户问题回答商品、要求配置、当前购买标价及币种，区分附条件优惠，附来源 URL 和采集时间。"
              "税费、库存、运费等用户未要求的补充字段若缺失，可简短注明 unknown，不因此判定标价查询失败，不进入结账。"
              "最终报告直接回传 Lead，无需结构化 finish。完成或受阻后用 action=close 关闭自己的 sessionId。"
              "不购买、不支付、不绕过验证码或站点保护。不修改源码配置，不读取历史评估答案。"
              "独立后台会话，不连接用户 Chrome，不使用代理。运行期间无人介入。")
    if args.compare:
        prompt = prompt.replace('来源 Agent 使用当前单工具 shopswarm_browser，给 Jev 一个具体浏览子目标；工具返回后按真实观察判断。',
          '若当前 profile 提供 shopswarm_browser，来源 Agent 首先用 action=act、startUrl 和一个具体浏览子目标 goal，让 Jev 选择动作；不要只用 open 代替 act。随后根据实际结果继续工具或同会话 CLI fallback；若页面在 Jev 请求前受阻，如实记录。否则直接使用安装的 agent-browser CLI。浏览器配置由启动环境决定，不覆盖 AGENT_BROWSER_CONFIG。CLI 路径为 node /home/jin/开源/ShopSwarm/node_modules/agent-browser/bin/agent-browser.js，每条命令使用 --headed false --auto-connect false 和本任务唯一 session。')
        prompt = prompt.replace('先读 skills/shopping-research/SKILL.md。', '若插件可用先读 skills/shopping-research/SKILL.md。')
        prompt = prompt.replace('完成或受阻后用 action=close 关闭自己的 sessionId。', '完成或受阻后关闭自己的会话。')
    save(folder / 'prompt.txt', prompt)
    before_focus = focus()
    previous_focus = before_focus
    changes = []
    before_sessions = sessions()
    started = now()
    timer = time.monotonic()
    print(json.dumps({'case': case['id'], 'phase': 'started', 'startedAt': started, 'output': str(folder)}, ensure_ascii=False), flush=True)
    descriptor = os.open(folder / 'cli.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as log:
        run_env = env.copy()
        for name in list(run_env):
            if name.startswith('AGENT_BROWSER_'):
                run_env.pop(name, None)
        config_path = folder / 'browser-config.json'
        save(config_path, {'profile': args.chrome_profile} if mode == 'browser-profile' else {})
        run_env['AGENT_BROWSER_CONFIG'] = str(config_path.resolve())
        profile = 'shopping-eval-' + mode if args.compare else args.profile
        command = ['bash', 'scripts/run-dsh.sh', '--profile', profile]
        if args.compare or args.profile != 'headless':
            command += ['--patch', str(ROOT / 'scripts/dsh-headless.patch.yml')]
        command += ['--json', prompt]
        process = subprocess.Popen(command, cwd=ROOT, env=run_env, stdout=log, stderr=subprocess.STDOUT)
        while process.poll() is None:
            current_focus = focus()
            if current_focus != previous_focus:
                changes.append({'elapsedMs': round((time.monotonic() - timer) * 1000), 'focus': current_focus})
                previous_focus = current_focus
            time.sleep(2)
    ended = now()
    elapsed = round((time.monotonic() - timer) * 1000)
    log_text = redact((folder / 'cli.log').read_text())
    save(folder / 'cli.log', log_text)
    cli_events = []
    for line in log_text.splitlines():
        try:
            event = json.loads(line)
            if isinstance(event, dict):
                cli_events.append(event)
        except ValueError:
            pass
    root_ids = {event['sessionId'] for event in cli_events if event.get('type') == 'session' and 'sessionId' in event}
    tool_results = []
    recovered = []
    usage_totals = {}
    models = set()
    tool_calls = []
    dsh_home = Path(env.get('SHOPSWARM_DSH_HOME') or env.get('DSH_HOME') or Path.home() / '.dsh')
    # DSH 0.1.7 child IDs are bare UUIDs; associate them by stored parentSession.
    session_paths = {}
    children = {}
    for candidate in (dsh_home / 'sessions').glob('*/*/session.v4.jsonl.zstd'):
        try:
            decompressor = subprocess.Popen(['zstd', '-d', '-c', str(candidate)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            header_line = decompressor.stdout.readline()
            decompressor.terminate()
            decompressor.communicate()
            header = json.loads(header_line)
            session_id = header.get('id')
            if session_id:
                session_paths[session_id] = candidate
                children.setdefault(header.get('parentSession'), []).append(session_id)
        except (OSError, ValueError):
            continue
    pending = list(root_ids)
    seen = set()
    while pending:
        session_id = pending.pop()
        if session_id in seen:
            continue
        seen.add(session_id)
        pending.extend(children.get(session_id, []))
        path = session_paths.get(session_id)
        if not path:
            continue
        try:
            content = redact(subprocess.check_output(['zstd', '-d', '-c', str(path)], text=True))
        except (OSError, subprocess.SubprocessError):
            continue
        save(folder / f'{session_id}.jsonl', content)
        recovered.append(session_id)
        records = []
        for line in content.splitlines():
            try:
                record = json.loads(line)
                records.append(record)
            except ValueError:
                pass
        for record in records:
            if record.get('type') == 'assistant/message':
                data = record.get('data', {})
                for key, value in data.get('usage', {}).items():
                    if isinstance(value, (int, float)):
                        usage_totals[key] = usage_totals.get(key, 0) + value
                source = data.get('message', {}).get('source', {})
                if source:
                    models.add(json.dumps({key: source.get(key) for key in ['kind', 'provider', 'model']}, sort_keys=True))
            if record.get('type') == 'tool/call':
                data = record.get('data', {})
                tool_calls.append({'sessionId': session_id, 'name': data.get('name'), 'arguments': data.get('arguments')})
        calls = {record.get('data', {}).get('callId'): record.get('data', {}) for record in records if record.get('type') == 'tool/call'}
        for record in records:
            data = record.get('data', {})
            if record.get('type') != 'tool/result':
                continue
            message = data.get('message', {})
            call = calls.get(message.get('toolCallId'), {})
            name = call.get('name', '')
            for block in message.get('content', []):
                text = block.get('text', '')
                if not text:
                    continue
                if name.startswith('shopswarm_'):
                    try:
                        value = json.loads(text)
                    except ValueError:
                        value = {'raw': text}
                    tool_results.append({'sessionId': session_id, 'tool': name, 'arguments': call.get('arguments'), 'isError': message.get('isError', False), 'value': value})
                if name in {'subagent', 'subagent_fork'}:
                    import re
                    pending.extend(re.findall(r'session-[0-9a-f-]{36}', text))
    save(folder / 'plugin-results.json', tool_results)
    save(folder / 'tool-calls.json', tool_calls)
    save(folder / 'usage.json', {'dshAllSessions': usage_totals, 'modelSources': sorted(models), 'jevAccounting': 'review per-step plugin metrics separately; never count cumulative metrics twice'})
    final = [event for event in cli_events if event.get('type') in {'text', 'final', 'message', 'result'}]
    save(folder / 'final-events.json', final)
    metadata = {'case': case, 'startedAt': started, 'endedAt': ended, 'elapsedMs': elapsed, 'exitCode': process.returncode,
                'rootSessionIds': sorted(root_ids), 'recoveredSessionIds': recovered, 'pluginResultCount': len(tool_results),
                'evaluationMode': mode, 'chromeProfile': args.chrome_profile if mode == 'browser-profile' else None,
                'browserMode': 'headed=false, auto-connect=false; ' + ('named Profile read-only copy' if mode == 'browser-profile' else 'no Profile'), 'focusBefore': before_focus, 'focusAfter': focus(),
                'focusChanges': changes, 'sessionsBefore': before_sessions, 'sessionsAfter': sessions(),
                'intervention': False, 'taskSuccess': 'pending evidence review; exit 0 and reported are not success criteria'}
    save(folder / 'run-metadata.json', metadata)
    all_results.append(metadata)
    save(out / 'runs.json', all_results)
    print(json.dumps({'case': case['id'], 'phase': 'finished', 'elapsedMs': elapsed, 'exitCode': process.returncode, 'pluginResultCount': len(tool_results)}, ensure_ascii=False), flush=True)
