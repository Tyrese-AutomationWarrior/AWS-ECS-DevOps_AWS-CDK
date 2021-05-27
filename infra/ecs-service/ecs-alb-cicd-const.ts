import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';


export interface EcsAlbCicdProps {
    vpc: ec2.IVpc;
    cluster: ecs.ICluster;
    stackName: string;
    service: ecs.IBaseService;
    appPath: string;
    containerName: string;
    repoName: string;
}

export class EcsAlbCicdConstrunct extends cdk.Construct {

    constructor(scope: cdk.Construct, id: string, props: EcsAlbCicdProps) {
        super(scope, id);

        const repo = new codecommit.Repository(this, `${props.stackName}Repository`, {
            repositoryName: `${props.stackName}-${props.repoName}`.toLowerCase(),
            description: 'service team cicd',
        });
        new cdk.CfnOutput(this, 'CodeCommit Name', { value: repo.repositoryName });

        const ecrRepo = new ecr.Repository(this, `${props.stackName}EcrRepository`, {
            repositoryName: `${props.stackName}-${props.repoName}`.toLowerCase()
        });

        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

        const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
            actionName: 'CodeCommit_SourceMerge',
            repository: repo,
            output: sourceOutput,
            branch: 'master'
        })

        const buildAction = new codepipeline_actions.CodeBuildAction({
            actionName: 'CodeBuild_DockerBuild',
            project: this.createBuildProject(ecrRepo, props),
            input: sourceOutput,
            outputs: [buildOutput],
        });

        const approvalAction = new codepipeline_actions.ManualApprovalAction({
            actionName: 'Manual_Approve',
        });

        const deployAction = new codepipeline_actions.EcsDeployAction({
            actionName: 'ECS_Deploy',
            service: props.service,
            imageFile: new codepipeline.ArtifactPath(buildOutput, `imagedefinitions.json`)
        });

        new codepipeline.Pipeline(this, 'ECSServicePipeline', {
            pipelineName: `${props.stackName}-Pipeline`,
            stages: [
                {
                    stageName: 'Source',
                    actions: [sourceAction],
                },
                {
                    stageName: 'Build',
                    actions: [buildAction],
                },
                {
                    stageName: 'Approve',
                    actions: [approvalAction],
                },
                {
                    stageName: 'Deploy',
                    actions: [deployAction],
                }
            ]
        });
    }

    private createBuildProject(ecrRepo: ecr.Repository, props: EcsAlbCicdProps): codebuild.Project {
        const project = new codebuild.Project(this, 'DockerBuild', {
            projectName: `${props.stackName}DockerBuild`,
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
                computeType: codebuild.ComputeType.LARGE,
                privileged: true
            },
            environmentVariables: {
                'CLUSTER_NAME': {
                    value: `${props.cluster.clusterName}`
                },
                'ECR_REPO_URI': {
                    value: `${ecrRepo.repositoryUri}`
                },
                'CONTAINER_NAME': {
                    value: `${props.containerName}`
                },
                'APP_PATH': {
                    value: `${props.appPath}`
                },
                'BACK_PATH': {
                    value: '../..'
                }
            },
            buildSpec: codebuild.BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    pre_build: {
                        commands: [
                            'echo "In Pre-Build Phase"',
                            'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}'
                        ]
                    },
                    build: {
                        commands: [
                            'echo "In Build Phase"',
                            'cd $APP_PATH',
                            `docker build -t $ECR_REPO_URI:$TAG .`,
                            '$(aws ecr get-login --no-include-email)',
                            'docker push $ECR_REPO_URI:$TAG'
                        ]
                    },
                    post_build: {
                        commands: [
                            'echo "In Post-Build Phase"',
                            'cd $BACK_PATH',
                            "printf '[{\"name\":\"%s\",\"imageUri\":\"%s\"}]' $CONTAINER_NAME $ECR_REPO_URI:$TAG > imagedefinitions.json",
                            "pwd; ls -al; cat imagedefinitions.json"
                        ]
                    }
                },
                artifacts: {
                    files: [
                        'imagedefinitions.json'
                    ]
                }
            }),
        });

        ecrRepo.grantPullPush(project.role!);

        project.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "ecs:DescribeCluster",
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer"
            ],
            resources: [`${props.cluster.clusterArn}`],
        }));

        return project;
    }
}