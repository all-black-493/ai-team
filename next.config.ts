import type { NextConfig } from "next"

const nextConfig: NextConfig = {
    allowedDevOrigins: ['192.168.0.15'],
    // The Daytona SDK loads form-data (for file uploads) with a dynamic
    // require, which breaks when it's bundled. Node loads it as-is instead.
    serverExternalPackages: ["@daytona/sdk"],
}

export default nextConfig
