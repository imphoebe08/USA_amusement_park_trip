export type PreparationTask = {
  title: string
  assignee: string
  assignees?: string[]
  done: boolean
  mode?: string
}

export const getTaskAssignees = (task: PreparationTask): string[] =>
  [...new Set(task.assignees?.length ? task.assignees : [task.assignee || '全體'])]

export const createPreparationTasks = (title: string, mode: string, selected: string[], members: string[], done = false): PreparationTask[] => {
  const assignees = [...new Set(selected.length ? selected : ['全體'])]
  if (mode === '待辦') return [{ title, mode, done, assignee: assignees.includes('全體') ? '全體' : assignees.join('、'), assignees: assignees.includes('全體') ? ['全體'] : assignees }]
  const owners = assignees.includes('全體') ? members : assignees
  return [...new Set(owners)].map(assignee => ({ title, mode, done, assignee, assignees: [assignee] }))
}

export const normalizePreparationTasks = (tasks: PreparationTask[], members: string[]): PreparationTask[] => tasks.flatMap(task => {
  const mode = task.mode || '待辦'
  // Do not discard legacy group items when the trip has no members yet.
  if (mode !== '待辦' && getTaskAssignees(task).includes('全體') && !members.length) return [{ ...task, mode }]
  return createPreparationTasks(task.title, mode, getTaskAssignees(task), members, task.done)
})

export const parseDraftAssignees = (value: string | undefined, legacy = '全體'): string[] => {
  if (!value) return [legacy || '全體']
  try {
    const selected: unknown = JSON.parse(value)
    return Array.isArray(selected) ? selected.filter((name): name is string => typeof name === 'string') : []
  } catch { return [legacy || '全體'] }
}

// Keep legacy owners reachable even after a member is renamed or removed.
export const getPreparationPages = (tasks: PreparationTask[], mode: string, members: string[]): string[] =>
  [...new Set([...members, ...tasks.filter(task => (task.mode || '待辦') === mode).flatMap(getTaskAssignees)])]
