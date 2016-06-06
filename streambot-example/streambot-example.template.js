// # Streambot Example Template
// This template sets up a Lambda function that simply reads records from a
// Kinesis stream, and writes those records to S3. Your service may operate
// entirely differently. It may define other resources, it may use another
// method to invoke the Lambda function. This is only meant to provide an
// example of one possible configuration.
module.exports = {
    "AWSTemplateFormatVersion": "2010-09-09",
    "Description": "A simple streambot example",
    // ## Parameters
    // When starting the stack you provide various options that will become
    // runtime configuration for the Lambda Function
    "Parameters": {
        "GitSha": {
            "Type": "String",
            "Description": "The Streambot GitSha to which this example pertains"
        },
        "EventBucket": {
            "Type": "String",
            "Description": "The S3 bucket where events will be written"
        },
        "EventPrefix": {
            "Type": "String",
            "Description": "The S3 prefix where events will be written"
        },
        "StreambotEnvFunctionArn": {
            "Type": "String",
            "Description": "The ARN for the StreambotEnv function set up by the primary Streambot template"
        }
    },
    // ## Resources
    // Five resources are created:
    // - A Kinesis Stream intended to feed the Lambda function
    // - An IAM Role that the Lambda function assumes, providing the Lambda
    // function with the permissions to do what it needs to do
    // - A custom resource backed by the StreambotEnv global Lambda function
    // which writes the intended runtime configuration to record in DynamoDB
    // - The Lambda function that is the heart of the example service
    // - An event source mapping linking the function to a kinesis stream
    // function which creates an event source mapping between the Kinesis
    // stream and the Lambda function
    "Resources": {
        // ### Kinesis stream
        // A Kinesis stream with one shard. Records in this stream with
        // trigger invocation of the primary Lambda function.
        "Stream": {
            "Type": "AWS::Kinesis::Stream",
            "Properties": {
                "ShardCount": 1
            }
        },
        // ### Lambda's runtime role
        // An IAM Role that can be assumed by the primary Lambda function.
        "Role": {
            "Type": "AWS::IAM::Role",
            "Properties": {
                "Path": "/streambot/",
                // #### Assume role policy
                // Identifies that this role can be assumed by a Lambda function.
                "AssumeRolePolicyDocument": {
                    "Statement": [
                        {
                            "Sid": "",
                            "Effect": "Allow",
                            "Principal": {
                                "Service": "lambda.amazonaws.com"
                            },
                            "Action": "sts:AssumeRole"
                        }
                    ]
                },
                "Policies": [
                    {
                        // #### Runtime policy
                        // Defines the permissions that the Lambda function will
                        // have once it has assumed this role.
                        "PolicyName": "StreambotExamplePolicy",
                        "PolicyDocument": {
                            "Statement": [
                                // - The Lambda function must be able to write
                                // CloudWatch logs.
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "logs:*"
                                    ],
                                    "Resource": "arn:aws:logs:*:*:*"
                                },
                                // - The Lambda function must be able to read
                                // its configuration file from DynamoDB
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "dynamodb:GetItem"
                                    ],
                                    "Resource": {
                                        "Fn::Join": [
                                            "",
                                            [
                                                "arn:aws:dynamodb:us-east-1:",
                                                {
                                                    "Ref": "AWS::AccountId"
                                                },
                                                ":table/streambot-env*"
                                            ]
                                        ]
                                    }
                                },
                                // - This Lambda function intends to write
                                // Kinesis records to S3. It must be given
                                // permission to do so.
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "s3:PutObject",
                                        "s3:PutObjectAcl"
                                    ],
                                    "Resource": {
                                        "Fn::Join": [
                                            "",
                                            [
                                                "arn:aws:s3:::",
                                                {
                                                    "Ref": "EventBucket"
                                                },
                                                "/",
                                                {
                                                    "Ref": "EventPrefix"
                                                },
                                                "*"
                                            ]
                                        ]
                                    }
                                },
                                // - This Lambda function must be given
                                // permission to read from the Kinesis stream
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "kinesis:GetRecords",
                                        "kinesis:GetShardIterator",
                                        "kinesis:DescribeStream",
                                        "kinesis:ListStreams"
                                    ],
                                    "Resource": {
                                        "Fn::Join": [
                                            "",
                                            [
                                                "arn:aws:kinesis:",
                                                {
                                                    "Ref": "AWS::Region"
                                                },
                                                ":",
                                                {
                                                    "Ref": "AWS::AccountId"
                                                },
                                                ":stream/",
                                                {
                                                    "Ref": "Stream"
                                                }
                                            ]
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        },
        // ## Primary Lambda Function
        // This is the Lambda function that defines this example service (see
        // streambot-example/index.js). It reads records from a Kinesis stream
        // and writes them to S3.
        "Function": {
            "Type" : "AWS::Lambda::Function",
            "Properties" : {
                // - Code: You must upload your Lambda function as a .zip file
                // to S3, and refer to it here.
                "Code" : {
                    "S3Bucket": "mapbox",
                    "S3Key": {
                        "Fn::Join": [
                            "",
                            [
                                "apps/streambot/",
                                {
                                    "Ref": "GitSha"
                                },
                                "-example.zip"
                            ]
                        ]
                    }
                },
                // - Role: Refers to the ARN of the Role defined
                // above.
                "Role" : {
                    "Fn::GetAtt": [
                        "Role",
                        "Arn"
                    ]
                },
                // - Other parameters as described by
                // [the AWS documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html).
                "Description" : "Streambot example function",
                "Handler" : "index.streambot",
                "MemorySize" : 128,
                "Runtime" : "nodejs",
                "Timeout" : 10
            }
        },
        // ### Runtime configuration creator
        // This custom resource is backed by a globally-defined Lambda Function
        // (see Streambot's primary template). It puts the intended
        // configuration to a record in DynamoDB, which the Lambda function can
        // read at runtime.
        "Config": {
            "Type": "Custom::StreambotEnv",
            "Properties": {
                // - ServiceToken: after setting up the primary Streambot
                // template, you must provide the ARN to the StreambotEnv
                // function it created.
                "ServiceToken": {
                    "Ref": "StreambotEnvFunctionArn"
                },
                // - FunctionName: you must provide the complete name of the
                // Lambda function this configuration pertains to.
                "FunctionName": {
                    "Ref": "Function"
                },
                // - Any other Properties provided will be written into the
                // configuration file as key-value pairs.
                "EventBucket": {
                    "Ref": "EventBucket"
                },
                "EventPrefix": {
                    "Ref": "EventPrefix"
                }
            }
        },
        // ## Kinesis-Lambda connector
        // http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-eventsourcemapping.html
        "Connector": {
            "Type": "AWS::Lambda::EventSourceMapping",
            // By depending on the configuration, we can make sure that stream
            // events are not fed to the Lambda function before the runtime
            // configuration is ready.
            "DependsOn": "Config",
            "Properties": {
                // - FunctionName: the name of the primary Lambda function.
                "FunctionName": {
                    "Ref": "Function"
                },
                // - EventSourceArn: the ARN for the Stream
                "EventSourceArn": {
                    "Fn::Join": [
                        "",
                        [
                            "arn:aws:kinesis:",
                            {
                                "Ref": "AWS::Region"
                            },
                            ":",
                            {
                                "Ref": "AWS::AccountId"
                            },
                            ":stream/",
                            {
                                "Ref": "Stream"
                            }
                        ]
                    ]
                },
                // - Other optional parameters include `BatchSize` (max. number
                // of records per Lambda Invocation), `StartingPosition` (Stream
                // iterator type), and `Enabled`.
                "BatchSize": 1,
                "StartingPosition": "TRIM_HORIZON",
                "Enabled": true
            }
        }
    },
    "Outputs": {
        "StreamName": {
            "Value": {
                "Ref": "Stream"
            }
        }
    }
};
