# streambot

[![Build Status](https://travis-ci.org/mapbox/streambot.svg?branch=master)](https://travis-ci.org/mapbox/streambot)

Streambot is a tool to help you manage [AWS Lambda](http://aws.amazon.com/lambda/) functions as persistent services via [AWS CloudFormation templates](http://aws.amazon.com/cloudformation/). It provides assistance for common scenarios where existing CloudFormation support is still inadequate.

#### Runtime configuration

Lambda functions are inherently stateless, but a well-designed [Twelve-factor app](http://12factor.net/config) separates configuration from code. The [existing Lambda API](http://docs.aws.amazon.com/lambda/latest/dg/API_Reference.html) offers no way for you to configure your application differently across multiple deploys. Streambot provides helper functions to manage and load runtime configuration parameters separately from your code.

#### EventSourceMappings

[An EventSourceMapping](http://docs.aws.amazon.com/lambda/latest/dg/API_EventSourceMappingConfiguration.html) connects a Kinesis or DynamoDB stream to a Lambda function, causing records in the stream to trigger Lambda invocations. Presently, there is no support for EventSourceMappings as standalone CloudFormation resources. Streambot provides a way to manage EventSourceMappings through [a custom CloudFormation resource](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html).

#### Node.js function bundling

In order to manage a Lambda function via CloudFormation, the code behind your function must be bundled into a `.zip` file and uploaded to S3. If your function has dependencies that include C++ addons precompiled via [node-pre-gyp](https://github.com/mapbox/node-pre-gyp), Streambot will help you bundle your code with dependencies for the correct platform/architecture to run on AWS Lambda, regardless of your native OS.

## Installation

#### The Streambot stack

To use Streambot, you must run a single [CloudFormation stack](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacks.html) in your AWS account using Streambot's primary template. To do this, clone and build Streambot:

```sh
$ git checkout https://github.com/mapbox/streambot
$ cd streambot
$ npm install
$ npm run-script build
# Template file is written to `./cloudformation/streambot.template`
# See ./docs/streambot.template.html for details of the resources that are created
```

Now you can start a new CloudFormation stack using the template. You may do this using [the web console](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stack.html) or using an automation tool such as [cfn-config](https://github.com/mapbox/cfn-config). *Note:* you **must** create this template in the `us-east-1` region. If you don't, your Lambda functions will not know where to find their runtime configuration.

## Your service stack

Once the Streambot stack has been created, you're ready to write your own Lambda-backed services. The `streambot-example` folder provides an example of how a service might look. There are a number of concepts to grasp as you embark on this journey.

### Bundling your code with streambot

Streambot provides a wrapper function for you to put around your code. This wrapper makes sure that any runtime configuration for your function is loaded into the environment before your function runs. To use this streambot wrapper, you'll adjust your module's `index.js` file to look like:

```js
var streambot = require('streambot');

function myFunction(event, callback) {
  // This is your custom code to process an event.
  // fire the `callback` when finished, in familiar Node.js-style (err first,
  // result after).

  // Using the streambot wrapper means that `process.env` will be populated with
  // your runtime configuration.
}

module.exports.streambot = streambot(myFunction);
```

If your function has dependencies that include C++ addons precompiled via [node-pre-gyp](https://github.com/mapbox/node-pre-gyp), you can use Streambot's `bin/bundle` script to bundle your code with dependencies for the correct platform/architecture to run on AWS Lambda, regardless of your native OS. Once you've bundled your function, you need to upload it to S3.

### Writing your CloudFormation template

Your CloudFormation template will need to create a [Lambda function](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html) and also an [IAM role](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-iam-role.html) defining that function's permissions. Using Streambot may mean adding a couple more resources, depending on how you wish to use it.

#### IAM Role

You'll have to make an IAM role, and it should completely cover any permissions that your function needs in order to do what it is supposed to do. Additionally, you need to make sure that your function has permission to read runtime configuration from the DynamoDB table created by Streambot's primary template.

```json
{
    "Effect": "Allow",
    "Action": [
        "dynamodb:GetItem"
    ],
    "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/streambot-env*"
    }
}
```

#### StreambotEnv

If your Lambda function needs runtime configuration, you'll need to create a [a custom CloudFormation resource](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html) backed by the `StreambotEnv` Lambda function created as part of the primary Streambot template. This custom resource will manage a record in DynamoDB that your Lambda functions can read their runtime configuration from.

```json
{
    "Type": "Custom::StreambotEnv",
    "Properties": {
        "ServiceToken": "arn:aws:lambda:us-east-1:123456789012:function:StreambotEnvFunction",
        "FunctionName": "my-lambda-function",
        "EventBucket": "my-event-bucket",
        "EventPrefix": "my-event-prefix"
    }
}
```

Property | Description
--- | ---
**ServiceToken** | The ARN for the StreambotEnv function provided by Streambot's primary template. This is available as an output from the primary stack.
**FunctionName** | The name of the Lambda function which you're providing configuration for.
-any other- | All other properties passed to the custom resource will be provided as environment key-value pairs to your Lambda function at runtime.

#### StreambotConnector

If your Lambda function intends to read from a Kinesis or DynamoDB stream, you'll need to create an [EventSourceMapping](http://docs.aws.amazon.com/lambda/latest/dg/API_EventSourceMappingConfiguration.html) between your stream and your Lambda function. There is not presently CloudFormation support for these resources. Instead, you can use another [a custom CloudFormation resource](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html), this one backed by the `StreambotConnector` Lambda function created as part of the primary Streambot template.

```json
{
        "Type": "Custom::StreambotConnector",
        "DependsOn": "StreambotExampleConfiguration",
        "Properties": {
            "ServiceToken": "arn:aws:lambda:us-east-1:123456789012:function:StreambotConnectorFunction",
            "FunctionRegion": "us-east-1",
            "FunctionName": "my-lambda-function",
            "StreamArn": "arn:aws:kinesis:us-east-1:123456789012:stream/my-kinesis-stream",
            "BatchSize": 1,
            "StartingPosition": "LATEST"
        }
    }
```

Property | Description
--- | ---
**ServiceToken** | The ARN for the StreambotConnector function provided by Streambot's primary template. This is available as an output from the primary stack.
**FunctionName** | The name of the Lambda function which you're connecting a stream to.
**FunctionRegion** | The AWS region in which the Lambda function is located
**StreamArn** | The ARN for the stream to feed the Lambda function
BatchSize | [100] The maximum number of stream records to be processed per Lambda invocation
StartingPosition | [TRIM_HORIZON] The stream iterator type, either `TRIM_HORIZON` or `LATEST`
Enabled | [true] True or false

#### Example

The example service in the `streambot-example` folder demonstrates a Lambda-backed service that uses Streambot. The purpose of the service is simply to read records from a Kinesis stream, and write them verbatim to files on S3. See `./docs/streambot-example.template.html` and `./docs/streambot-example.index.html` for detailed discussion of the example template and code.
