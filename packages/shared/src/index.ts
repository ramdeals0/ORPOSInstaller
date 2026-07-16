export const DEFAULT_INSTALL_PATH = 'C:\\OracleRetailStore\\CLIENT'
export const DEFAULT_BACKUP_RULE = 'CLIENT_{yyyyMMdd_HHmmss}'
export const DEFAULT_REMOTE_COPY = 'C:\\Temp\\ORPOS\\copy'
export const DEFAULT_REMOTE_UNZIP = 'C:\\Temp\\ORPOS\\extract'

export const STEP_KEYS = [
  'queued',
  'prechecks',
  'backup_current_install',
  'copy_zip',
  'unzip',
  'place_properties',
  'run_install',
  'inspect_log',
  'terminal',
] as const

export type StepKey = (typeof STEP_KEYS)[number]

export const HOSTNAME_REGEX = /^(?<storeCode>.+?)pos(?<registerId>\d{3,})$/i

export interface ParsedHostname {
  storeCode: string
  registerId: number
  registerIdPadded: string
}

export function parseHostname(hostname: string): ParsedHostname | null {
  const match = hostname.trim().match(HOSTNAME_REGEX)
  if (!match?.groups) return null
  const registerId = Number(match.groups.registerId)
  if (!Number.isFinite(registerId)) return null
  return {
    storeCode: match.groups.storeCode,
    registerId,
    registerIdPadded: String(registerId).padStart(3, '0'),
  }
}

export function resolveRegisterGroup(
  registerId: number,
  rules: Array<{ name: string; minRegId: number; maxRegId: number; priority: number; isActive?: boolean }>,
): string {
  const active = rules
    .filter((r) => r.isActive !== false && registerId >= r.minRegId && registerId <= r.maxRegId)
    .sort((a, b) => a.priority - b.priority)
  return active[0]?.name ?? 'Unassigned'
}

export function formatBackupName(rule: string, date = new Date()): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  }
  return rule.replace(/\{yyyyMMdd_HHmmss\}/g, `${tokens.yyyy}${tokens.MM}${tokens.dd}_${tokens.HH}${tokens.mm}${tokens.ss}`)
    .replace(/yyyy/g, tokens.yyyy)
    .replace(/MM/g, tokens.MM)
    .replace(/dd/g, tokens.dd)
    .replace(/HH/g, tokens.HH)
    .replace(/mm/g, tokens.mm)
    .replace(/ss/g, tokens.ss)
}

export function previewBackupPath(installPath: string, rule: string, date = new Date()): string {
  const parent = installPath.includes('\\')
    ? installPath.split('\\').slice(0, -1).join('\\')
    : installPath.split('/').slice(0, -1).join('/')
  const sep = installPath.includes('\\') ? '\\' : '/'
  return `${parent}${sep}${formatBackupName(rule, date)}`
}

export const DEFAULT_SETTINGS = {
  defaultPaths: {
    currentInstallPath: DEFAULT_INSTALL_PATH,
    remoteCopyPath: DEFAULT_REMOTE_COPY,
    remoteUnzipPath: DEFAULT_REMOTE_UNZIP,
    antPropertiesPath: '',
    installerZipPath: '',
  },
  backupNaming: {
    pattern: DEFAULT_BACKUP_RULE,
    clock: 'target' as const,
  },
  throttle: { default: 10, min: 1, max: 20 },
  schedulingDefaults: {
    timezone: 'UTC',
    minLeadMinutes: 5,
  },
  logParsingRules: {
    logGlob: '**/ORPOS-{releaseNumber}/pos-install-*log',
    successRegex: 'Installation completed successfully',
    failureRegex: 'BUILD FAILED|Installation failed',
    inconclusiveIsFailure: true,
  },
  winrm: {
    port: 5985,
    useSsl: false,
    connectTimeoutSeconds: 30,
    authMode: 'negotiate',
  },
  prechecks: {
    checkProcessLocks: false,
    checkRebootPending: false,
    extractRatio: 2.5,
    diskSafetyMarginPercent: 10,
  },
  retention: { jobDays: 180, logDays: 90 },
  reachability: { probeIntervalMinutes: 30 },
} as const

export type DefaultSettings = typeof DEFAULT_SETTINGS

export const TERMINAL_TARGET_STATUSES = [
  'PRECHECK_FAILED',
  'SUCCEEDED',
  'FAILED',
  'ROLLBACK_SUCCEEDED',
  'ROLLBACK_FAILED',
  'CANCELLED',
  'DRY_RUN_PASSED',
  'DRY_RUN_FAILED',
] as const

export const RETRYABLE_TARGET_STATUSES = [
  'PRECHECK_FAILED',
  'FAILED',
  'ROLLBACK_FAILED',
  'DRY_RUN_FAILED',
  'CANCELLED',
] as const

export function isTerminalTargetStatus(status: string): boolean {
  return (TERMINAL_TARGET_STATUSES as readonly string[]).includes(status)
}

export function isRetryableTargetStatus(status: string): boolean {
  return (RETRYABLE_TARGET_STATUSES as readonly string[]).includes(status)
}
