/*
 * The nightly collection, as a Container Apps job (ADR 0025).
 *
 * It used to be a GitHub Actions cron. That runner sat outside Azure, so every night it opened a
 * hole in the Postgres firewall and closed it again; GitHub fired the 05:00 schedule anywhere up
 * to eight hours late, straight into the window when merges deploy; and a failed night was an
 * email to whoever happened to be watching. A job in the same environment as the app connects
 * the way the app does, fires on the minute, and writes `ingest_jobs`, which /datasamling reads.
 *
 * The job runs `pnpm ingest:job` (packages/core/scripts/ingest-job.ts). Everything about the
 * order and what a failure costs lives there, not here.
 */

@description('Short app name, used for resource naming.')
param appName string = 'hendingar'

@description('Environment suffix: dev | prod.')
param env string = 'dev'

param location string = resourceGroup().location

@description('Image to run. Required, for the same reason as the app: no placeholder to roll back to.')
param containerImage string

@description('The commit the image was built from. Recorded on every job and source run.')
param revision string

param acrLoginServer string
param managedEnvironmentId string
param runtimeIdentityId string
param postgresFqdn string
param postgresAdminUser string

@secure()
param postgresAdminPassword string

@description('The app\'s public URL. The job POSTs its /api/kurator once the rows exist (ADR 0018). Empty skips curation.')
param appUrl string = ''

@description('''
UTC. 05:00 is 07:00 in Norway in summer and 06:00 in winter: finished well before anyone looks
for what is on today. Container Apps fires on the minute, unlike the GitHub cron it replaces.
''')
param cronExpression string = '0 5 * * *'

var dbName = appName
var tags = {
  project: 'hendingar.no'
  app: appName
  env: env
  iac: 'bicep'
  component: 'ingest'
}

resource ingest 'Microsoft.App/jobs@2024-03-01' = {
  name: 'caj-${appName}-ingest-${env}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityId}': {}
    }
  }
  properties: {
    environmentId: managedEnvironmentId
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      /*
       * Seconds. The same hour as JOB_TIMEOUT_MS in packages/core/src/ingest-job.ts: a row still
       * `running` past it is read as interrupted, because this is what killed it.
       *
       * A night takes about ten minutes, most of it the slowest upstream's crawl delay.
       */
      replicaTimeout: 3600
      /*
       * No retries. A retry would start a second job row and run every importer again, and the
       * importers are already isolated from each other: one source failing costs only itself.
       * A night that fails outright is reported on /datasamling and tried again tomorrow.
       */
      replicaRetryLimit: 0
      registries: [
        {
          server: acrLoginServer
          identity: runtimeIdentityId
        }
      ]
      secrets: [
        {
          name: 'database-url'
          // uriComponent so a password containing +, / or = cannot corrupt the URL.
          value: 'postgres://${postgresAdminUser}:${uriComponent(postgresAdminPassword)}@${postgresFqdn}:5432/${dbName}?sslmode=require'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'ingest'
          image: containerImage
          // Four importers run at once (`--workspace-concurrency=4`), each its own Node process.
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              // A run started by hand through .github/workflows/ingest.yml says `schedule` too:
              // overriding one variable on a job start replaces the whole container definition.
              name: 'INGEST_TRIGGER'
              value: 'schedule'
            }
            {
              name: 'INGEST_REVISION'
              value: revision
            }
            {
              name: 'KURATOR_URL'
              value: empty(appUrl) ? '' : '${appUrl}/api/kurator'
            }
          ]
        }
      ]
    }
  }
}

output jobName string = ingest.name
