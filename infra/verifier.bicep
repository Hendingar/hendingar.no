// verifier.bicep — the verification microservice.
//
// Separate from app.bicep for the same reason app.bicep is separate from main.bicep: it takes an
// image parameter, so it must never be applied by a platform converge.
//
// `external: false` is the point of this file. The service is reachable only from inside the
// Container Apps environment, so the only caller is the web app. An unauthenticated /extract
// endpoint on the public internet would be a free vision-model proxy for anyone who found it.

@description('Short app name, used for resource naming.')
param appName string = 'hendingar'

@description('Environment suffix: dev | prod.')
param env string = 'dev'

param location string = resourceGroup().location

@description('Image to run. Required — no placeholder default, so a deploy cannot roll the service back to something else.')
param containerImage string

param acrLoginServer string
param managedEnvironmentId string
param runtimeIdentityId string

@description('Client id of the runtime identity, so the SDK picks the right one inside the container.')
param runtimeIdentityClientId string

@description('Azure OpenAI / AI Foundry account endpoint.')
param openAiEndpoint string

@description('Model *deployment* name on that account.')
param openAiDeployment string

var tags = {
  project: 'hendingar.no'
  app: appName
  env: env
  iac: 'bicep'
  component: 'verifier'
}

resource verifier 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${appName}-verifier-${env}'
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
        // Internal only. See the file header.
        external: false
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
      // No secrets block: there is nothing to store. The identity mints its own token.
    }
    template: {
      containers: [
        {
          name: 'verifier'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: openAiEndpoint
            }
            {
              name: 'AZURE_OPENAI_CHAT_MODEL'
              value: openAiDeployment
            }
            {
              // ManagedIdentityCredential needs this when more than one identity could apply.
              name: 'AZURE_CLIENT_ID'
              value: runtimeIdentityClientId
            }
            {
              name: 'PORT'
              value: '8080'
            }
          ]
          probes: [
            {
              // /health does not call the model, so this stays cheap and does not consume quota.
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 15
            }
          ]
        }
      ]
      scale: {
        // Scales to zero: no submissions, no cost. The first submission after idle pays a cold
        // start, which is why the app's extract timeout is generous.
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
}

output verifierUrl string = 'https://${verifier.properties.configuration.ingress.fqdn}'
output containerAppName string = verifier.name
