export const SANDBOX_DEFAULTS = {
  autoStopMinutes: 15,
  autoArchiveDays: 7,
}

export const SANDBOX_LIMITS = {
  autoStopMinutes: 1440,
  autoArchiveDays: 30,
}

export const NETWORK_POLICIES = {
  default: "Daytona's default",
  domains: "Only these domains",
  blocked: "No internet",
} as const

export type NetworkPolicy = keyof typeof NETWORK_POLICIES

// Daytona's list prices, in US dollars an hour, and a bot sandbox's size:
// Daytona's default, 1 vCPU, 1 GiB of memory and 3 GiB of disk. Disk is
// free up to 5 GiB, so a stopped sandbox costs nothing.
export const SANDBOX_RATES = { vcpuHour: 0.0504, memoryGiBHour: 0.0162 }
export const SANDBOX_SIZE = { vcpu: 1, memoryGiB: 1 }

export function domainsOf(list: string | null | undefined) {
  return (list ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}
