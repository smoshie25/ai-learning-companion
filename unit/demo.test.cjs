const {test}=require('node:test')
const assert=require('node:assert/strict')
const {runScenario}=require('../demo/scenario.cjs')
test('ten-step MVP demo composes sessions, sources, plans, interviews, official MCP and scheduled approved alerts',async()=>{const report=await runScenario();assert.equal(report.steps.length,10);assert.equal(report.deliveries.length,3);assert.equal(report.monitoring.alerts.length,1);assert.equal(report.monitoring.alerts[0].state,'sent');assert.equal(report.monitoring.runs.filter(r=>r.state==='sent').length,1);assert.ok(report.steps[1].gaps.length);assert.ok(report.steps[5].topics.length)})
