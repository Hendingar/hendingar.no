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
        // Scales to zero. The app costs nothing when idle; the database does not (ADR 0007).
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output containerAppName string = app.name
