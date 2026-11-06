# CloudDevOps

Node.js app with a deployment dashboard, deployed by GitHub Actions to EC2 through Systems Manager. Listens on port 8000.

Run locally in demo mode: `npm install && npm start`, then open http://localhost:8000 (sign in with the dashboard login, default admin@example.com / admin123).

## GitHub variables
Repository: `AWS_REGION`, `ECR_REPOSITORY`, `AWS_BUILD_ROLE_ARN`.
Environments `staging` and `production`: `AWS_DEPLOY_ROLE_ARN`.

## EC2 instances
- Docker, AWS CLI, curl and the SSM agent installed.
- Tags `App=cloud-devops-app` and `Env=staging|production`.
- Instance role: AmazonSSMManagedInstanceCore, ECR read, `ssm:PutParameter` and `ssm:GetParameters` on `/cloud-devops-app/*`, `ec2:DescribeInstances`, `ecr:DescribeImages`.
- Runtime config in `/etc/cloud-devops-app/<env>.env` (copy `.env.example`, set real secrets).
- Security group allows port 8000 from your load balancer or users, and no SSH.

The dashboard shows live data once `ECR_REPOSITORY` is set (images, instances, release tags) and `GITHUB_TOKEN` + `GITHUB_REPO` are set (runs and deploy buttons).
