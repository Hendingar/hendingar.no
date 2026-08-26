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
