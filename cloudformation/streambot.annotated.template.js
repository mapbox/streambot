// # Primary Streambot template
// In order to use Streambot, you must "install" it by running one instance of this template in your AWS account.
// This creates two Lambda function which your own custom stacks can all on via custom CloudFormation resources.
{
    "AWSTemplateFormatVersion": "2010-09-09",
    "Description": "Streambot Lambda functions",
    // ## Parameters
    // You must provide Streambot with three configuration parameters. Be conscious that the choice of `EnvBucket` and `EnvPrefix` that you choose here will determine where configuration files can be stored for any of your Lambda-backed services.
    "Parameters": {
        "GitSha": {
            "Type": "String",
            "Description": "The GitSha of Streambot to deploy"
        },
        "EnvBucket": {
            "Type": "String",
            "Description": "S3 Bucket for Lambda runtime environment storage"
        },
        "EnvPrefix": {
            "Type": "String",
            "Description": "S3 Prefix for Lambda runtime environment storage"
        }
    },
    // ## Resources
    // The stack creates two Lambda functions, and two IAM roles for those Lambda functions to assume
    "Resources": {
        // ### Environment configuration role
        // This role is assumed but the StreambotEnv function
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
                        // Defines the permissions that the Lambda function will have once it has assumed this role.
                        "PolicyName": "StreambotEnvPolicy",
                        "PolicyDocument": {
                            "Statement": [
                                // - The Lambda function must be able to write CloudWatch logs.
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "logs:*"
                                    ],
                                    "Resource": "arn:aws:logs:*:*:*"
                                },
                                // - The Lambda function must be able to write configuration files to the S3 bucket/prefix of your choosing. *Note*: all of your Lambda-backed services must explicitly write configuration files to this S3 bucket/prefix.
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "s3:PutObject",
                                        "s3:DeleteObject"
                                    ],
                                    "Resource": {
                                        "Fn::Join": [
                                            "", [
                                                "arn:aws:s3:::",
                                                {
                                                    "Ref": "EnvBucket"
                                                },
                                                "/",
                                                {
                                                    "Ref": "EnvPrefix"
                                                },
                                                "*"
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
        // ### StreambotEnv
        // This function is intended to be run by a custom CloudFormation resource, and it is used to write a configuration file to S3
        "StreambotEnvFunction": {
            "Type" : "AWS::Lambda::Function",
            "Properties" : {
                // - Code: The location of Streambot's code for the desired GitSha/version. This file is publically available from a Mapbox bucket, or you could host the file in your own bucket if you wish. It is simply a `.zip` file containing Streambot's `index.js` file.
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
                                ".zip"
                            ]
                        ]
                    }
                },
                // - Handler: Identifies which function from Streambot's `index.js` this Lambda function should execute. This should always be set to `index.env`.
                "Handler" : "index.env",
                // - Role: A reference to the IAM role defined above that allows this Lambda function to write files to S3.
                "Role" : {
                    "Fn::GetAtt": [
                        "StreambotEnvRole",
                        "Arn"
                    ]
                },
                // - Other properties as outlined in the [AWS documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html).
                "Runtime" : "nodejs",
                "Description" : "Builds runtime environment for Lambda functions",
                "MemorySize" : 128,
                "Timeout" : 10
            }
        },
        // ### Environment configuration role
        // This role is assumed but the StreambotConnector function
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
                        // Defines the permissions that the Lambda function will have once it has assumed this role.
                        "PolicyName": "StreambotConnectorPolicy",
                        "PolicyDocument": {
                            "Statement": [
                                // - The Lambda function must be able to write CloudWatch logs.
                                {
                                    "Effect": "Allow",
                                    "Action": [
                                        "logs:*"
                                    ],
                                    "Resource": "arn:aws:logs:*:*:*"
                                },
                                // - The Lambda function must be allowed to manage event source mappings.
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
        // This function is intended to be run by a custom CloudFormation resource, and it is used to manage event source mappings between Kinesis/DynamoDB streams and Lambda functions.
        "StreambotConnectorFunction": {
            "Type" : "AWS::Lambda::Function",
            "Properties" : {
                // - Code: The location of Streambot's code for the desired GitSha/version. This file is publically available from a Mapbox bucket, or you could host the file in your own bucket if you wish. It is simply a `.zip` file containing Streambot's `index.js` file.
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
                                ".zip"
                            ]
                        ]
                    }
                },
                // - Handler: Identifies which function from Streambot's `index.js` this Lambda function should execute. This should always be set to `index.env`.
                "Handler" : "index.connector",
                // - Role: A reference to the IAM role defined above that allows this Lambda function to write files to S3.
                "Role" : {
                    "Fn::GetAtt": [
                        "StreambotConnectorRole",
                        "Arn"
                    ]
                },
                // - Other properties as outlined in the [AWS documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html).
                "Description" : "Create event source mappings between streams and Lambda functions",
                "MemorySize" : 128,
                "Runtime" : "nodejs",
                "Timeout" : 10
            }
        }
    },
    // ## Outputs
    // For convenience, the Streambot stack provides outputs for values you will need in order to implement Lambda-backed services.
    "Outputs": {
        // ### StreambotEnv
        // This will be referenced by custom CloudFormation resources in your service templates.
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
        // This will be referenced by custom CloudFormation resources in your service templates.
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
        },
        // ### Valid configuration URL
        // When using the StreambotEnv function, you must specify a path where the configuration file will be written that is within this S3 bucket/prefix.
        "ValidEnvUrl": {
            "Value": {
                "Fn::Join": [
                    "",
                    [
                        "s3://",
                        {
                            "Ref": "EnvBucket"
                        },
                        "/",
                        {
                            "Ref": "EnvPrefix"
                        },
                        "*"
                    ]
                ]
            }
        }
    }
}
