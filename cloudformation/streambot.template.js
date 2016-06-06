var streambot = require('..');

// # Primary Streambot template
// In order to use Streambot, you must "install" it by running one instance of
// this template in your AWS account. This creates two Lambda function which
// your own custom stacks can all on via custom CloudFormation resources. It
// also creates one DynamoDB table which must be called `streambot-env` where
// runtime configurations for your Lambda functions are stored.
// **It must be run in us-east-1**, because the DynamoDB table must be in a very
// well-known location.
module.exports = {
    "AWSTemplateFormatVersion": "2010-09-09",
    "Description": "Streambot Lambda functions",
    // ## Parameters
    "Parameters": {
        // Providing the Git SHA or version number of Streambot here insures that
        // your Lambda functions are created using the expected version of Streambot.
        "GitSha": {
            "Type": "String",
            "Description": "The GitSha of Streambot to deploy"
        },
        // Provide the ARN of an existing streambot table in us-east-1 if running
        // Streambot in another region
        "ExistingStreambotTable": {
            "Type": "String",
            "Description": "The ARN of an existing",
            "Default": ""
        }
    },
    // ## Conditions
    "Conditions": {
        // Determines whether or not a table should be created
        "MakeTable": {
            "Fn::Equals": [
                {
                    "Ref": "ExistingStreambotTable"
                },
                ""
            ]
        }
    },
    // ## Resources
    // The stack creates two Lambda functions, and two IAM roles for those
    // Lambda functions to assume, and one DynamoDB table.
    "Resources": {
        // ### Configuration table
        // This DynamoDB table contains runtime configuration settings for your
        // Lambda functions.
        "StreambotEnvTable": {
            "Type": "AWS::DynamoDB::Table",
            "Condition": "MakeTable",
            "DeletionPolicy" : "Retain",
            "Properties": {
                // It is important that this table name be hard-wired. Otherwise
                // Lambda functions will not know where to look for
                // their configuration.
                "TableName": streambot.tableName,
                "AttributeDefinitions": [
                    {
                        "AttributeName": "name",
                        "AttributeType": "S"
                    }
                ],
                "KeySchema": [
                    {
                        "KeyType": "HASH",
                        "AttributeName": "name"
                    }
                ],
                "ProvisionedThroughput": {
                    "ReadCapacityUnits": "10",
                    "WriteCapacityUnits": "10"
                }
            }
        },
        // ### Environment configuration role
        // This role is assumed by the StreambotEnv function
        "StreambotEnvRole": {
            "Type": "AWS::IAM::Role",
            "Properties": {
                // #### Assume role policy
                // Identifies that this role can be assumed by a Lambda function.
                "Path": "/streambot/",
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
                        "PolicyName": "StreambotEnvPolicy",
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
                                // - The Lambda function must be able to write
                                // configuration files to the DynamoDB table.
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "dynamodb:PutItem",
                                        "dynamodb:DeleteItem"
                                    ],
                                    "Resource": {
                                        "Fn::If": [
                                            "MakeTable",
                                            {
                                                "Fn::Join": [
                                                    "", [
                                                        "arn:aws:dynamodb:us-east-1:",
                                                        {
                                                            "Ref": "AWS::AccountId"
                                                        },
                                                        ":table/",
                                                        {
                                                            "Ref": "StreambotEnvTable"
                                                        },
                                                        "*"
                                                    ]
                                                ]
                                            },
                                            {
                                                "Ref": "ExistingStreambotTable"
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        },
        // ### StreambotEnv
        // This function is intended to be run by a custom CloudFormation
        // resource, and it is used to write a configuration file to S3.
        "StreambotEnvFunction": {
            "Type" : "AWS::Lambda::Function",
            "Properties" : {
                // - Code: The location of Streambot's code for the desired
                // GitSha/version. This file is publically available from a
                // Mapbox bucket, or you could host the file in your own bucket
                // if you wish. It is simply a `.zip` file containing
                // Streambot's `index.js` file.
                "Code" : {
                    "S3Bucket": {
                        "Fn::Join": [
                            "-",
                            [
                                "mapbox",
                                {
                                    "Ref": "AWS::Region"
                                }
                            ]
                        ]
                    },
                    "S3Key": {
                        "Fn::Join": [
                            "",
                            [
                                "release/streambot/",
                                {
                                    "Ref": "GitSha"
                                },
                                ".zip"
                            ]
                        ]
                    }
                },
                // - Handler: Identifies which function from Streambot's
                // `index.js` this Lambda function should execute. This should
                // always be set to `index.env`.
                "Handler" : "index.env",
                // - Role: A reference to the IAM role defined above that allows
                // this Lambda function to write files to DynamoDB.
                "Role" : {
                    "Fn::GetAtt": [
                        "StreambotEnvRole",
                        "Arn"
                    ]
                },
                // - Other properties as outlined in the
                // [AWS documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html).
                "Runtime" : "nodejs",
                "Description" : "Builds runtime environment for Lambda functions",
                "MemorySize" : 128,
                "Timeout" : 10
            }
        },
        // ### Environment configuration role
        // This role is assumed by the StreambotConnector function
        "StreambotConnectorRole": {
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
                        "PolicyName": "StreambotConnectorPolicy",
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
                                // - The Lambda function must be allowed to
                                // manage event source mappings.
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "lambda:CreateEventSourceMapping",
                                        "lambda:GetEventSourceMapping",
                                        "lambda:UpdateEventSourceMapping",
                                        "lambda:DeleteEventSourceMapping",
                                        "lambda:ListEventSourceMappings"
                                    ],
                                    "Resource": "*"
                                }
                            ]
                        }
                    }
                ]
            }
        },
        // ### StreambotConnector
        // This function is intended to be run by a custom CloudFormation
        // resource, and it is used to manage event source mappings between
        // Kinesis/DynamoDB streams and Lambda functions.
        "StreambotConnectorFunction": {
            "Type" : "AWS::Lambda::Function",
            "Properties" : {
                // - Code: The location of Streambot's code for the desired
                // GitSha/version. This file is publically available from a
                // Mapbox bucket, or you could host the file in your own bucket
                // if you wish. It is simply a `.zip` file containing
                // Streambot's `index.js` file.
                "Code" : {
                    "S3Bucket": {
                        "Fn::Join": [
                            "-",
                            [
                                "mapbox",
                                {
                                    "Ref": "AWS::Region"
                                }
                            ]
                        ]
                    },
                    "S3Key": {
                        "Fn::Join": [
                            "",
                            [
                                "release/streambot/",
                                {
                                    "Ref": "GitSha"
                                },
                                ".zip"
                            ]
                        ]
                    }
                },
                // - Handler: Identifies which function from Streambot's
                // `index.js` this Lambda function should execute. This should always be set to `index.env`.
                "Handler" : "index.connector",
                // - Role: A reference to the IAM role defined above that allows
                // this Lambda function to write files to S3.
                "Role" : {
                    "Fn::GetAtt": [
                        "StreambotConnectorRole",
                        "Arn"
                    ]
                },
                // - Other properties as outlined in the
                // [AWS documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html).
                "Description" : "Create event source mappings between streams and Lambda functions",
                "MemorySize" : 128,
                "Runtime" : "nodejs",
                "Timeout" : 10
            }
        }
    },
    // ## Outputs
    // For convenience, the Streambot stack provides outputs for values you will
    // need in order to implement Lambda-backed services.
    "Outputs": {
        // ### StreambotEnv
        // This will be referenced by custom CloudFormation resources in your
        // service templates.
        // - The name of the StreambotEnv function
        "StreambotEnvFunctionName": {
            "Value": {
                "Ref": "StreambotEnvFunction"
            }
        },
        // - The ARN of the StreambotEnv function
        "StreambotEnvFunctionArn": {
            "Value": {
                "Fn::GetAtt": [
                    "StreambotEnvFunction",
                    "Arn"
                ]
            }
        },
        // ### StreambotConnector
        // This will be referenced by custom CloudFormation resources in your
        // service templates.
        // - The name of the StreambotConnector function
        "StreambotConnectorFunctionName": {
            "Value": {
                "Ref": "StreambotConnectorFunction"
            }
        },
        // - The ARN of the StreambotConnector function
        "StreambotConnectorFunctionArn": {
            "Value": {
                "Fn::GetAtt": [
                    "StreambotConnectorFunction",
                    "Arn"
                ]
            }
        }
    }
};
