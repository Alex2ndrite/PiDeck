with open('src/renderer/src/App.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Delete visibleAgents useMemo
old = ('  const visibleAgents = useMemo(\n'
       '    () =>\n'
       '      displayAgents.filter((agent) =>\n'
       '        matches(agent.title + agent.cwd + (agent.sessionId ?? ""), search),\n'
       '      ),\n'
       '    [displayAgents, search],\n'
       '  );\n')
assert old in c, 'visibleAgents not found'
c = c.replace(old, '')

# Delete refreshSessionHistory
old = ('  async function refreshSessionHistory(projectId = sessionsProjectId) {\n'
       '    if (!projectId) return;\n'
       '    setSessionHistoryLoading(true);\n'
       '    try {\n'
       '      await refreshProjectSessions(projectId, true);\n'
       '    } finally {\n'
       '      setSessionHistoryLoading(false);\n'
       '    }\n'
       '  }\n\n')
assert old in c, 'refreshSessionHistory not found'
c = c.replace(old, '')

with open('src/renderer/src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print('OK')
