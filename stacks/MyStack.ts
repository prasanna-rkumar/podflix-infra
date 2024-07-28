import { OAuthScope, ProviderAttribute, UserPoolClientIdentityProvider, UserPoolIdentityProviderGoogle } from "aws-cdk-lib/aws-cognito";
import { BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { RemovalPolicy } from "aws-cdk-lib/core";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";

import { StackContext, Bucket, Cognito, Table, Function } from "sst/constructs";

export function API({ stack }: StackContext) {

  const coreTable = new Table(stack, "CoreTable", {
    fields: {
      PK: "string",
      SK: "string",
      GSI1PK: "string",
      GSI1SK: "string",
    },
    primaryIndex: {
      partitionKey: "PK",
      sortKey: "SK",
    },
    globalIndexes: {
      reverseIndex: {
        partitionKey: "SK",
        sortKey: "PK",
      },
      GSI1: {
        partitionKey: "GSI1PK",
        sortKey: "GSI1SK",
      },
    },
    stream: "new_and_old_images",
    cdk: {
      table: {
        pointInTimeRecovery: true,
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.RETAIN,
      }
    }
  });

  const presignupTrigger = new Function(stack, "PreSignupTrigger", {
    handler: "packages/functions/src/pre-signup-trigger/index.handler",
  });

  presignupTrigger.attachPermissions([
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cognito-idp:ListUsers"],
      resources: ["*"],
    })
  ]);

  const postSignupTrigger = new Function(stack, "PostSignupTrigger", {
    handler: "packages/functions/src/post-signup-trigger/index.handler",
    bind: [coreTable],
    environment: {
      TABLE_NAME: coreTable.tableName,
    }
  });

  postSignupTrigger.attachPermissions([
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cognito-idp:ListUsers"],
      resources: ["*"],
    })
  ]);

  const cognito = new Cognito(stack, "Auth", {
    login: ["email"],
    triggers: {
      preSignUp: presignupTrigger,
      postConfirmation: postSignupTrigger
    },
    cdk: {
      userPoolClient: {
        generateSecret: true,
        authFlows: {
          userPassword: true,
          userSrp: true,
          custom: true,
        },
        supportedIdentityProviders: [UserPoolClientIdentityProvider.GOOGLE],
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
          },
          scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
          callbackUrls: ["http://localhost:3000/api/auth/callback/cognito", "https://podflix-three.vercel.app/api/auth/callback/cognito"],
        },

      },
    }
  });

  const googleProvider = new UserPoolIdentityProviderGoogle(stack, "GoogleProvider", {
    attributeMapping: {
      givenName: ProviderAttribute.GOOGLE_GIVEN_NAME,
      familyName: ProviderAttribute.GOOGLE_FAMILY_NAME,
      email: ProviderAttribute.GOOGLE_EMAIL,
    },
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    userPool: cognito.cdk.userPool,
    scopes: ["email", "profile", "openid"],
  });

  cognito.cdk.userPool.addDomain("cognito-audiogram-domain", {
    cognitoDomain: {
      domainPrefix: stack.stage === "local" ? "audiogram" : "podflix",
    }
  })
  cognito.cdk.userPool.registerIdentityProvider(googleProvider);

  const bucket = new Bucket(stack, "public", {
    cors: [
      {
        allowedMethods: ["GET"],
        allowedOrigins: ["*"],
        allowedHeaders: ["*"],
      }
    ]
  });

  const ffmpegLayer = new lambda.LayerVersion(stack, "ffmpegLayer", {
    code: lambda.Code.fromAsset("packages/layers/ffmpeg")
  })

  const importEpisodeLambda = new Function(stack, "ImportEpisodeLambda", {
    handler: "packages/functions/src/import-episode-lambda/index.handler",
    environment: {
      TABLE_NAME: coreTable.tableName,
      BUCKET_NAME: bucket.bucketName,
      FFPROBE_COMMAND: stack.stage === "local" ? "ffprobe" : "/opt/ffprobe",
    },
    memorySize: 3008,
    diskSize: 2048,
    timeout: "15 minutes",
    bind: [coreTable, bucket],
    layers: [ffmpegLayer]
  });

  const clipEpisodeLambda = new Function(stack, "ClipEpisodeLambda", {
    handler: "packages/functions/src/clip-episode-lambda/index.handler",
    environment: {
      TABLE_NAME: coreTable.tableName,
      BUCKET_NAME: bucket.bucketName,
      FFPROBE_COMMAND: stack.stage === "local" ? "ffprobe" : "/opt/ffprobe",
      FFMPEG_COMMAND: stack.stage === "local" ? "ffmpeg" : "/opt/ffmpeg",
      DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
    },
    memorySize: 3008,
    diskSize: 2048,
    timeout: "15 minutes",
    bind: [coreTable, bucket],
    layers: [ffmpegLayer]
  });

  stack.addOutputs({
    stage: stack.stage,
    cognito: cognito.userPoolArn,
    bucket: bucket.bucketName,
    coreTable: coreTable.tableName,
    importEpisodeLambda: importEpisodeLambda.functionArn,
    clipEpisodeLambda: clipEpisodeLambda.functionArn,
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
  });
}
