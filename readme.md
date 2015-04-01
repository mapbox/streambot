# streambot

[![Build Status](https://magnum.travis-ci.com/mapbox/streambot.svg?token=JyZqLLKLnyx6pp4ze6j1&branch=master)](https://magnum.travis-ci.com/mapbox/streambot)

A sibling of Watchbot, focused on using Lambda to consume records from Kinesis.

## When to use it

You have a service that will involve consuming events from a Kinesis stream. Optionally, your service may include other AWS resources, perhaps responsible for writing data to the stream.

## How to use it

Your service is a node.js module. Follow these steps:

1. create your module's `package.json` with `streambot` as a dependency
2. add a pacakge.json `script` that references streambot's deploy script

  ```json
  {
    "scripts": {
      "deploy": "streambot-deploy"
    }
  }
  ```

3. define `main` in package.json. This module should export your service function wrapped by streambot. For example:

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

First, define an `<environment>` for your system. This might be something like `production` or `testing`. Create a CloudFormation stack using your template, and name your stack `<pacakge name>-<environment>`. Next, deploy your lambda function:

```
npm run deploy <environment> [--region <region>]
```

This runs streambot's deploy scripts, which will:

- write a `.env` file in your repository containing information about the resources, parameters, and outputs from your CloudFormation stack.
- remove your existing `node_modules` directory, then reinstall for the appropriate platform/arch to run on Lambda
- zip your service into a file and put it at `build/bundle.zip`
- remove the `node_modules` directory again, before reinstalling without flags so you can keep working
- deploy your bundle to Lambda with a function name equal to your

## What streambot provides

#### Runtime environment

Streambot provides a wrapper for your Lambda function
- base64 decodes the `data` associated with each kinesis record
- provides information to your function about your CloudFormation stack's parameters, resources, and outputs via `process.env`
- provides `streambot.log`, a [fastlog](https://github.com/willwhite/fastlog) object that is capable of uploading your logs to an S3 bucket/prefix of your choosing
- sends metrics to CloudWatch indicating success or failure from your function, as well as an alarm that will trigger when errors occur

#### Deployment scripts

`streambot-deploy` bundles and deploys your lambda function, setting appropriate event triggers and roles. You should run this *after* you've deployed your service's CloudFormation template so that it can bundle information about you CloudFormation stack in a `.env` file.

#### AWS Resources

It creates a number of AWS resources, which can be accessed as CloudFormation stack outputs:

- `KinesisStream`: records written to this stream will trigger Lambda function execution
- `LambdaInvocationRole`: an IAM role that allows Lambda to read from the kinesis stream
- `LambdaExecutionRole`: an IAM role that you can extend to provide permissions that your Lambda function requires to execute
- `KinesisAdminRole`: an IAM role that an EC2 can assume which provides full privileges to manipulate the kinesis stream

## Gotchas

- You should not use any node.js modules that include C++ addons **unless** they are pre-built with [node-pre-gyp](https://github.com/mapbox/node-pre-gyp).
- There's a limit to the size of the zipfile that you can upload to Lambda. Using loads of C++ addon modules will very likely get you over that limit!
- Lambda function execution time is limited to 60 seconds. Work quickly!
- the intended workflow for using deploy scripts uses functionality from npm v2.0.0+
