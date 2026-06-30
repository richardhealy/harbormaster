#!/usr/bin/env node
import 'dotenv/config'
import { runCLI } from './index'
import { ImpactEstimator } from '../../impact'
import { Scheduler } from '../../scheduler'
import { createHotspotLeaseManager } from '../../hotspots'

const services = {
  impactEstimator: new ImpactEstimator(),
  scheduler: new Scheduler(),
  leaseManager: createHotspotLeaseManager(),
}

runCLI(process.argv.slice(2), services).then((code) => {
  process.exitCode = code
})
