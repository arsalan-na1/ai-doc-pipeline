# AI Document Intelligence Pipeline

## Stack
- Backend: AWS Lambda (Python) + DynamoDB + API Gateway + S3
- Frontend: React + Vite + Tailwind + shadcn/ui
- AI: nvidia/nemotron-3-super-120b-a12b:free via OpenRouter API
- CDN: CloudFront at https://d1ylmpdakie6yq.cloudfront.net

## Key files
- lambda/document_processor/lambda_function.py — parses + analyzes resumes
- lambda/results_api/lambda_function.py — serves results + job match
- frontend/ — React + Vite app, builds to dist/
- deploy/deploy.sh — builds frontend, zips lambdas, deploys to AWS

## Rules
- Never run full deploy.sh for Lambda-only changes — zip + update function code directly
- Always run tests before committing: pytest tests/
- API Gateway base URL is in frontend source — preserve it exactly
