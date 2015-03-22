# streambot

The brother of Watchbot, focused on using Lambda to consume records from Kinesis.

## When to use it

You have a service that will involve consuming events from a Kinesis stream. Optionally, your service may include other AWS resources, perhaps responsible for writing data to the stream.

## How to use it

Your service is a node.js module. This module includes:

- a module which exports a function that Lambda will execute
- a package.json file that defines streambot as a dependency
- the package.json file should point to your Lambda module via a config parameter named `lambda`:
  ```json
  {
    "config": {
      "lambda": "relative/path/to/Lambda/module"
    }
  }
  ```
- an AWS CloudFormation template that, at a minimum:
  - defines an `AWS::CloudFormation::Stack` resource which points to streambot's `TemplateURL`
  - provides the name of the streambot child-stack as an output called `StreambotStack`
  - extends the permissions defined by streambot's `LambdaExecutionRole` to provide all privileges needed by your Lambda function while it runs

See the `example` directory for ... an example!

## What streambot provides

#### AWS Resources

It creates a number of AWS resources, which can be accessed as CloudFormation stack outputs:

- `KinesisStream`: records written to this stream will trigger Lambda function execution
- `LambdaInvocationRole`: an IAM role that allows Lambda to read from the kinesis stream
- `LambdaExecutionRole`: an IAM role that you can extend to provide permissions that your Lambda function requires to execute
- `KinesisAdminRole`: an IAM role that an EC2 can assume which provides full privileges to manipulate the kinesis stream

#### Metrics and alarms

It puts a wrapper around your Lambda function which sends metric data to CloudWatch indicating a successful or errored run. It also creates an alarm that will trigger when errors occur. You can subscribe an email address to receive these alarm notifications when you create the streambot stack.

#### Deployment scripts

It provides a number of scripts that can be used to deploy your Lambda function. Once streambot is defined as a dependency to your project, you can access these scripts via `npm run`:

- `npm run wrap`: writes a `streambot.js` file that wraps your function. This is the function that will be used by Lambda.
- `npm run bundle`: bundles you project's wrapped code and its dependencies into a zipfile suitable for upload to Lambda.
- `npm run deploy`: bundles and deploys your lambda function, setting appropriate triggers and roles. You should run this *after* you've deployed your service's CloudFormation template.
- `npm run template-url`: simply prints the `TemplateUrl` for the version of streambot that you're using.

## Gotchas

- You should not use any node.js modules that include C++ addons **unless** they are pre-built with [node-pre-gyp](https://github.com/mapbox/node-pre-gyp).
