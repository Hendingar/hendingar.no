@description('Short app name, used for resource naming.')
param appName string = 'hendingar'

@description('Environment suffix: dev | prod.')
param env string = 'dev'

param location string = resourceGroup().location

@description('Image to run. Required — there is no placeholder default, so a deploy can never silently roll the app back to something else.')
param containerImage string

param acrLoginServer string
param managedEnvironmentId string
param runtimeIdentityId string
param postgresFqdn string
param postgresAdminUser string

@secure()
param postgresAdminPassword string

@description('Internal URL of the verifier service. Empty is valid and supported: submission still works, and everything routes to the human queue.')
param verifierUrl string = ''

@description('''
Custom domains bound to this app, as Microsoft.App ingress customDomains entries
({ name, certificateId, bindingType }).

This exists because ARM is declarative: a property the template omits is a property ARM removes.
Deploying without it silently unbound hendingar.no, www and dev — the certificates survived, but
the site stopped answering on every name a visitor actually uses, and nothing failed to make that
visible. The deploy workflow reads whatever is currently bound and passes it straight back, so a
hostname bound with `az containerapp hostname bind` outlives the next deploy.

Empty is correct for a fresh environment, where no certificate exists yet to bind against.
''')
param customDomains array = []

var dbName = appName
var tags = {
  project: 'hendingar.no'
  app: appName
  env: env
  iac: 'bicep'
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${appName}-${env}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        // null, not [], when empty: an empty array is still an instruction to unbind everything.
        customDomains: empty(customDomains) ? null : customDomains
      }
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
          name: appName
          image: containerImage
          /*
           * Readiness only, and deliberately not liveness.
           *
           * `/health` runs `select 1` against the database, which is exactly what readiness should
           * mean: do not send a reader to a replica that cannot answer them. As a LIVENESS probe
           * the same endpoint would be actively harmful — a database blip would restart the
           * container, which cannot fix a database, and every restart buys another cold start on
           * top of the outage.
           */
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              // The app connects to Postgres on first query, so give it a moment before asking.
              initialDelaySeconds: 5
              periodSeconds: 15
              failureThreshold: 3
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'PORT'
              value: '8080'
            }
            {
              // Empty is a supported state, not a misconfiguration — src/env.ts treats '' as
              // unset and the UI hides the photo shortcut rather than offering a dead button.
              name: 'VERIFIER_URL'
              value: verifierUrl
            }
          ]
        }
      ]
      scale: {
        /*
         * One replica always warm. See docs/decisions/0011-no-cold-start.md.
         *
         * This used to be 0, which cost nothing when idle and made the first visitor after a quiet
         * spell wait for a container to start, Node to boot and Postgres to connect. On a site
         * whose entire job is answering "what is on tonight", that visitor is the one that matters
         * — they arrive from a link, once, and a blank tab is indistinguishable from a broken site.
         *
         * ADR 0007 already settled the principle while deciding something else: a site that is down
         * outside office hours is not a deployment. Scaling the app to zero is the same bet in
         * miniature, and the saving is small next to the database, which is a standing cost anyway.
         */
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output containerAppName string = app.name
