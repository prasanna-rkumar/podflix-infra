import { Callback, Context, PostConfirmationTriggerEvent } from "aws-lambda";
const { CognitoIdentityProviderClient, ListUsersCommand } = require("@aws-sdk/client-cognito-identity-provider");
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb"; // ES Modules import

const cognitoClient = new CognitoIdentityProviderClient();
const ddbClient = new DynamoDBClient();

export const handler = (async (event: PostConfirmationTriggerEvent, context: Context, callback: Callback<any>) => {

  const userPoolId = event.userPoolId;
  const userAttributes = event.request.userAttributes;
  const email = userAttributes.email;

  // get username and save it to db
  const command = new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${email}"`
  });

  const { Users } = await cognitoClient.send(command);

  if (!Users || Users.length === 0) {
    return event;
  }

  const user = Users[0];
  const username = user.Username;

  // save username to db
  const putCommand = new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      PK: { S: `USERNAME#${username}` },
      SK: { S: `USERNAME#${username}` },
      username: { S: username },
      usage: { M: {} },
    }
  });

  await ddbClient.send(putCommand);

  return event;
});
