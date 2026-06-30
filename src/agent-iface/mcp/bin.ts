#!/usr/bin/env node
import 'dotenv/config'
import { createMCPServer } from './index'
import { ImpactEstimator } from '../../impact'
import { Scheduler } from '../../scheduler'
import { createHotspotLeaseManager } from '../../hotspots'

const services = {
  impactEstimator: new ImpactEstimator(),
  scheduler: new Scheduler(),
  leaseManager: createHotspotLeaseManager(),
}

const server = createMCPServer(services)
server.run()
