export const DEFAULT_INSTALL_PATH = 'C:\\OracleRetailStore\\CLIENT'
export const DEFAULT_BACKUP_RULE = 'CLIENT_{yyyyMMdd_HHmmss}'
export const DEFAULT_REMOTE_COPY = 'C:\\Temp\\ORPOS\\copy'
export const DEFAULT_REMOTE_UNZIP = 'C:\\Temp\\ORPOS\\extract'
/** ant.installer.properties lives on the target host (local path), then is copied into the extracted installer root. */
export const DEFAULT_ANT_PROPERTIES_PATH = 'C:\\OracleRetailStore\\ant.installer.properties'

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

/** Hostname: <3-letter-store-code>POS<registerid> — always stored UPPERCASE, e.g. APPPOS001 */
export const HOSTNAME_REGEX = /^(?<storeCode>[A-Za-z]{3})pos(?<registerId>\d{3,})$/i

export interface ParsedHostname {
  storeCode: string
  registerId: number
  registerIdPadded: string
  /** Canonical uppercase hostname, e.g. APPPOS001 */
  hostname: string
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toUpperCase()
}

export function formatHostname(storeCode: string, registerId: number): string {
  return `${storeCode.toUpperCase()}POS${String(registerId).padStart(3, '0')}`
}

export function parseHostname(hostname: string): ParsedHostname | null {
  const match = hostname.trim().match(HOSTNAME_REGEX)
  if (!match?.groups) return null
  const registerId = Number(match.groups.registerId)
  if (!Number.isFinite(registerId)) return null
  const storeCode = match.groups.storeCode.toUpperCase()
  const registerIdPadded = String(registerId).padStart(3, '0')
  return {
    storeCode,
    registerId,
    registerIdPadded,
    hostname: `${storeCode}POS${registerIdPadded}`,
  }
}

/** Numeric store id → 3-letter hostname code (from store master list). */
export const STORE_CATALOG: ReadonlyArray<{ storeNumber: number; storeCode: string; name?: string }> = [
  { storeNumber: 100, storeCode: 'APP' },
  { storeNumber: 200, storeCode: 'FDL' },
  { storeNumber: 300, storeCode: 'MAR' },
  { storeNumber: 400, storeCode: 'WAS' },
  { storeNumber: 500, storeCode: 'FEF' },
  { storeNumber: 700, storeCode: 'ALX' },
  { storeNumber: 800, storeCode: 'GBE' },
  { storeNumber: 900, storeCode: 'MEN' },
  { storeNumber: 1000, storeCode: 'BED' },
  { storeNumber: 1100, storeCode: 'PLY' },
  { storeNumber: 1200, storeCode: 'WAP' },
  { storeNumber: 1300, storeCode: 'MAN' },
  { storeNumber: 1400, storeCode: 'HUD' },
  { storeNumber: 1500, storeCode: 'STP' },
  { storeNumber: 1600, storeCode: 'GER' },
  { storeNumber: 1700, storeCode: 'OSH' },
  { storeNumber: 1800, storeCode: 'GBW' },
  { storeNumber: 1900, storeCode: 'ANT' },
  { storeNumber: 2000, storeCode: 'CLV' },
  { storeNumber: 2100, storeCode: 'STC' },
  { storeNumber: 2200, storeCode: 'ROC' },
  { storeNumber: 2300, storeCode: 'BAX' },
  { storeNumber: 2400, storeCode: 'BRP' },
  { storeNumber: 2500, storeCode: 'LKE' },
  { storeNumber: 2600, storeCode: 'WIN' },
  { storeNumber: 2700, storeCode: 'OAK' },
  { storeNumber: 2800, storeCode: 'FAR' },
  { storeNumber: 2900, storeCode: 'MSC' },
  { storeNumber: 3000, storeCode: 'OWT' },
  { storeNumber: 3100, storeCode: 'BLN' },
  { storeNumber: 3200, storeCode: 'CAR' },
  { storeNumber: 3300, storeCode: 'AKY' },
  { storeNumber: 3400, storeCode: 'CMB' },
  { storeNumber: 3500, storeCode: 'MKO' },
  { storeNumber: 3600, storeCode: 'HRM' },
  { storeNumber: 3700, storeCode: 'MTO' },
  { storeNumber: 5000, storeCode: 'OCO' },
  { storeNumber: 5100, storeCode: 'SXI' },
  { storeNumber: 5200, storeCode: 'EAU' },
  { storeNumber: 5300, storeCode: 'DEF' },
  { storeNumber: 5400, storeCode: 'DEV' },
  { storeNumber: 5500, storeCode: 'SXF' },
  { storeNumber: 5600, storeCode: 'CFI' },
  { storeNumber: 5800, storeCode: 'CRI' },
  { storeNumber: 5900, storeCode: 'WKE' },
  { storeNumber: 6200, storeCode: 'WBD' },
  { storeNumber: 6400, storeCode: 'RCS' },
  { storeNumber: 6500, storeCode: 'HST' },
  { storeNumber: 6600, storeCode: 'MSK' },
  { storeNumber: 6700, storeCode: 'BSK' },
]

export function storeCodeFromNumber(storeNumber: number): string | undefined {
  return STORE_CATALOG.find((s) => s.storeNumber === storeNumber)?.storeCode
}

export function storeNumberFromCode(storeCode: string): number | undefined {
  return STORE_CATALOG.find((s) => s.storeCode === storeCode.toUpperCase())?.storeNumber
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

/**
 * Register group ranges from ORPOS application.xml RegisterGroups
 * (RegisterG1–RegisterG14 EnumeratedListValidator member pairs).
 */
export const DEFAULT_REGISTER_GROUP_RULES = [
  { name: 'RegisterG1', minRegId: 1, maxRegId: 50, priority: 1 },
  { name: 'RegisterG2', minRegId: 100, maxRegId: 109, priority: 2 },
  { name: 'RegisterG3', minRegId: 110, maxRegId: 115, priority: 3 },
  { name: 'RegisterG4', minRegId: 150, maxRegId: 159, priority: 4 },
  { name: 'RegisterG5', minRegId: 260, maxRegId: 269, priority: 5 },
  { name: 'RegisterG6', minRegId: 360, maxRegId: 369, priority: 6 },
  { name: 'RegisterG7', minRegId: 470, maxRegId: 479, priority: 7 },
  { name: 'RegisterG8', minRegId: 570, maxRegId: 579, priority: 8 },
  { name: 'RegisterG9', minRegId: 680, maxRegId: 689, priority: 9 },
  { name: 'RegisterG10', minRegId: 790, maxRegId: 795, priority: 10 },
  { name: 'RegisterG11', minRegId: 830, maxRegId: 839, priority: 11 },
  { name: 'RegisterG12', minRegId: 930, maxRegId: 939, priority: 12 },
  { name: 'SCO Register', minRegId: 801, maxRegId: 829, priority: 13 }, // RegisterG13
  { name: 'Attendant Station', minRegId: 796, maxRegId: 800, priority: 14 }, // RegisterG14
] as const

export const DEFAULT_SETTINGS = {
  defaultPaths: {
    currentInstallPath: DEFAULT_INSTALL_PATH,
    remoteCopyPath: DEFAULT_REMOTE_COPY,
    remoteUnzipPath: DEFAULT_REMOTE_UNZIP,
    antPropertiesPath: DEFAULT_ANT_PROPERTIES_PATH,
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
  registerGroupRules: DEFAULT_REGISTER_GROUP_RULES,
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
