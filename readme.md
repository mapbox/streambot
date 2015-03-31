# streambot

[![Build Status](https://magnum.travis-ci.com/mapbox/streambot.svg?token=JyZqLLKLnyx6pp4ze6j1&branch=master)](https://magnum.travis-ci.com/mapbox/streambot)

A sibling of Watchbot, focused on using Lambda to consume records from Kinesis.

## When to use it

You have a service that will involve consuming events from a Kinesis stream. Optionally, your service may include other AWS resources, perhaps responsible for writing data to the stream.

## How to use it

Your service is a node.js module. Follow these steps:

1. create your module's `package.json` with `streambot` as a dependency
2. add a `script` that references streambot's deploy script
3. define your `main` module. This module should export your service function wrapped by streambot. For example:
  ```js
  var streambot = require('streambot');
  module.exports.streambot = streambot(function(records, callback) {
    // process `records` as you see fit
    callback();
  });
  ```
4. create an AWS CloudFormation template that, at a minimum:
  - defines an `AWS::CloudFormation::Stack` resource which points to streambot's `TemplateURL`
  - provides the name of the streambot child-stack as an output called `StreambotStack`
  - extends the permissions defined by streambot's `LambdaExecutionRole` to provide all privileges needed by your Lambda function while it runs

See the `streambot-example` directory.

#### To deploy

First, deploy your CloudFormation template using [mapbox-cli](https://github.com/mapbox/mapbox-cli).

Next, deploy your lambda function:

```
npm run deploy <environment> [--region <region>]
```

Where `deploy` is the name of the script in your service's package.json that references `streambot-deploy`. This will:

- write a `.env` file in your repository containing information about the resources, parameters, and outputs from your CloudFormation stack.
- remove your existing `node_modules` directory, then reinstall for the appropriate platform/arch to run on Lambda
- zip your service into a file and put it at `build/bundle.zip`
- remove the `node_modules` directory again, before reinstalling without flags
- deploy your bundle to Lambda

## What streambot provides

#### Deployment scripts

It provides scripts that can be used to deploy your Lambda function.

- `streambot-bundle`: bundles you project's code and its dependencies into a zipfile suitable for upload to Lambda.
- `streambot-deploy`: bundles and deploys your lambda function, setting appropriate triggers and roles. You should run this *after* you've deployed your service's CloudFormation template.

#### AWS Resources

It creates a number of AWS resources, which can be accessed as CloudFormation stack outputs:

- `KinesisStream`: records written to this stream will trigger Lambda function execution
- `LambdaInvocationRole`: an IAM role that allows Lambda to read from the kinesis stream
- `LambdaExecutionRole`: an IAM role that you can extend to provide permissions that your Lambda function requires to execute
- `KinesisAdminRole`: an IAM role that an EC2 can assume which provides full privileges to manipulate the kinesis stream
- `MetricName`: the name of the CloudWatch metric that tracks Lambda's success/failure

#### Metrics and alarms

It puts a wrapper around your Lambda function which sends metric data to CloudWatch indicating a successful or errored run. It also creates an alarm that will trigger when errors occur. You can subscribe an email address to receive these alarm notifications when you create the streambot stack.

## Gotchas

- You should not use any node.js modules that include C++ addons **unless** they are pre-built with [node-pre-gyp](https://github.com/mapbox/node-pre-gyp).
- There's a limit to the size of the zipfile that you can upload to Lambda. Using loads of C++ addon modules will very likely get you over that limit!
- Lambda function execution time is limited to 60 seconds. Work quickly!
- the intended workflow for using deploy scripts uses functionality from npm v2.0.0+
