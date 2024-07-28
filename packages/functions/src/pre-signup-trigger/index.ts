import { Callback, Context, PreSignUpTriggerEvent } from "aws-lambda";
const { CognitoIdentityProviderClient, ListUsersCommand } = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient();

export const handler = (async (event: PreSignUpTriggerEvent, context: Context, callback: Callback<any>) => {

  const userPoolId = event.userPoolId;
  const userAttributes = event.request.userAttributes;
  const email = userAttributes.email;

  const command = new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${email}"`
  });

  const { Users } = await cognitoClient.send(command);

  if (Users && Users.length > 0) {
    const user = Users[0];
    if (user.Username.includes("google")) {
      throw new Error("Signed up using gmail")
    }
    throw new Error("Email already in use");
  }

  return event;
});
