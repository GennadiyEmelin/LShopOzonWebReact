export const appRoles = [
  { value: 'Production', label: 'Производство' },
  { value: 'Designer', label: 'Дизайнер' },
  { value: 'Leadership', label: 'Руководство' },
  { value: 'Admin', label: 'Администратор' },
] as const

export function getRoleLabel(role: string) {
  return appRoles.find((item) => item.value === role)?.label ?? role
}
