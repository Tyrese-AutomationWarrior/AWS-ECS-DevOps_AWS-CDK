import * as ecs from '@aws-cdk/aws-ecs';

import * as base from '../../lib/template/stack/base/base-stack';
import { AppContext } from '../../lib/template/app-context';


export class EcsTaskStack extends base.BaseStack {

    constructor(appContext: AppContext, stackConfig: any) {
        super(appContext, stackConfig);

        const vpc = this.loadVpc(this.commonProps.appConfig.Stack.VpcInfra);
        const cloudMapNamespace = this.loadCloudMapNamespace();
        const ecsCluster = this.loadEcsCluster(vpc, cloudMapNamespace);

        const ecsService = this.createEcsServiceTask(ecsCluster);
    }

    private createEcsServiceTask(cluster: ecs.ICluster): ecs.FargateService {
        const baseName = this.stackName;

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
            memoryLimitMiB: 512,
            cpu: 256
        });

        const container = taskDefinition.addContainer("Container", {
            containerName: `${baseName}Container`,
            image: ecs.ContainerImage.fromAsset('codes/load-test-script'),
            // image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
            logging: new ecs.AwsLogDriver({
                streamPrefix: `${baseName}Log`
            }),
            environment: {
                Namespace: `${this.projectPrefix}-NS`,
                TargetServiceName: this.commonProps.appConfig.Stack.EcsAlb.Name
            }
        });

        const service = new ecs.FargateService(this, 'Service', {
            serviceName: `${baseName}Service`,
            cluster,
            taskDefinition,
            desiredCount: 1,
            cloudMapOptions: {
                name: this.stackName,
            }
        });

        return service;
    }
}
