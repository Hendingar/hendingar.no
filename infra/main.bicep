@description('Short app name, used for resource naming.')
param appName string = 'hendingar'

@description('Environment suffix: dev | prod.')
param env string = 'dev'

param location string = resourceGroup().location

@description('Postgres administrator login.')
param postgresAdminUser string = 'hendingar'

@description('Postgres administrator password. Supplied at deploy time from a GitHub secret — never stored in the repo. See ADR 0007.')
@secure()
param postgresAdminPassword string

@description('Container image to run. The first deploy uses a public placeholder because the registry is empty; the workflow updates this once an image exists.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Cheapest burstable tier. See ADR 0007 for why this is not serverless.')
param postgresSku string = 'Standard_B1ms'

@description('''
Wire the Container App to pull from our ACR. Must stay false on the very first deploy: the registry
is empty and the runtime identity has no AcrPull yet, and Container Apps validates registry access
at deploy time. Flip to true once an image exists and the grant is in place — see infra/BOOTSTRAP.md.
''')
param useAcr bool = false

var suffix = uniqueString(resourceGroup().id)
var acrName = 'acr${appName}${suffix}'
var pgName = 'psql-${appName}-${env}-${suffix}'
var dbName = appName
var tags = {
  project: 'hendingar.no'
  app: appName
  env: env
  iac: 'bicep'
}

// Runtime workload identity. Referenced by the Container App, and granted AcrPull separately —
// role assignments are deliberately NOT in this template because the CI principal only has
// Contributor on the resource group, and Contributor cannot write role assignments.
resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${appName}'
  location: location
  tags: tags
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    // Pull via managed identity, not shared credentials.
    adminUserEnabled: false
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${appName}-${env}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: tags
  sku: {
    name: postgresSku
    tier: 'Burstable'
  }
  properties: {
    version: '17'
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      // Burstable does not support HA. Recorded in ADR 0007 as an accepted limitation.
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: dbName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// PostGIS. Allow-listing it is a server parameter, settable with RG Contributor — no Owner needed.
// This is what resolves the open hosting risk in ADR 0005.
resource postgisExtension 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'POSTGIS'
    source: 'user-override'
  }
  dependsOn: [
    database
  ]
}

// 0.0.0.0–0.0.0.0 is Azure's magic range meaning "allow other Azure services", not "allow the
// internet". Container Apps reaches Postgres through this.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [
    postgisExtension
  ]
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${appName}-${env}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${appName}-${env}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: useAcr
        ? [
            {
              server: acr.properties.loginServer
              identity: runtimeIdentity.id
            }
          ]
        : []
      secrets: [
        {
          name: 'database-url'
          // uriComponent so a password containing +, / or = cannot corrupt the URL.
          value: 'postgres://${postgresAdminUser}:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${dbName}?sslmode=require'
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

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output containerAppName string = app.name
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output runtimeIdentityPrincipalId string = runtimeIdentity.properties.principalId
output runtimeIdentityResourceId string = runtimeIdentity.id
