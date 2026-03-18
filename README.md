# AI Document Intelligence Pipeline

Upload a resume PDF, get structured data back. Runs on AWS Free Tier. The only cost is OpenAI, which works out to about two cents a month at a hundred resumes.

You upload a PDF through a web dashboard, the system pulls out the text, sends it to GPT-4o-mini, and shows you the parsed results. Everything is serverless.

## How it works

```
                         ┌─────────────────────────────────────────────────┐
                         │                   AWS Cloud                     │
                         │                                                 │
  ┌──────────┐   PUT     │  ┌──────────┐  S3 Event   ┌──────────────────┐ │
  │          │──────────►│  │  S3      │────────────►│  Lambda:         │ │
  │  User    │  (presigned) │  (uploads)│             │  doc_processor   │ │
  │  Browser │           │  └──────────┘             │                  │ │
  │          │           │                           │  ┌────────────┐  │ │
  │          │           │                           │  │ PyMuPDF    │  │ │
  │          │           │                           │  │ (text      │  │ │
  │          │           │                           │  │ extraction)│  │ │
  │          │           │                           │  └─────┬──────┘  │ │
  │          │           │                           │        │         │ │
  │          │           │                           │  ┌─────▼──────┐  │ │
  │          │           │                           │  │ OpenAI     │  │ │
  │          │           │                           │  │ gpt-4o-mini│  │ │
  │          │           │                           │  │ (analysis) │  │ │
  │          │           │                           │  └─────┬──────┘  │ │
  │          │           │                           │        │         │ │
  │          │           │                           └────────┼─────────┘ │
  │          │           │                                    │           │
  │          │           │                           ┌────────▼─────────┐ │
  │          │           │                           │    DynamoDB      │ │
  │          │           │                           │  (results store) │ │
  │          │           │                           └────────▲─────────┘ │
  │          │           │                                    │           │
  │          │   GET     │  ┌──────────────┐  Proxy  ┌───────┴──────────┐│
  │          │◄─────────►│  │ API Gateway  │────────►│ Lambda:          ││
  │          │           │  │ (REST API)   │         │ results_api      ││
  └──────────┘           │  └──────────────┘         └──────────────────┘│
       ▲                 │                                                │
       │  Static Site    │  ┌──────────────┐                              │
       └─────────────────│──│ S3 (frontend)│                              │
                         │  │ static host  │                              │
                         │  └──────────────┘                              │
                         └─────────────────────────────────────────────────┘

  Secrets: SSM Parameter Store (OpenAI API key, encrypted at rest)
```

The browser uploads PDFs straight to S3 using a presigned URL so we skip API Gateway's 10MB payload limit. S3 fires an event, Lambda extracts text with PyMuPDF, sends it to GPT-4o-mini, and writes structured results to DynamoDB. A second Lambda serves those results to the frontend through API Gateway.

Why not Textract? It costs $1.50 per page. PyMuPDF does the same thing for free on standard PDFs.

## What you get back

Upload a resume and the system extracts:

- Contact info (name, email, phone)
- Skills, displayed as tags
- Work experience with company, role, duration, and highlights
- Education (where, what degree, when)
- A 2-sentence recruiter summary written by the LLM

## Before you start

You'll need:

- AWS CLI set up with your credentials (`aws configure`)
- An AWS account still in the Free Tier window
- An OpenAI API key from [platform.openai.com](https://platform.openai.com)
- Docker for building the Lambda Layer (or WSL on Windows)
- Python 3.11 if you want to test locally

## Getting started

### 1. Clone and configure

```bash
git clone https://github.com/arsalan-na1/ai-document-pipeline.git
cd ai-document-pipeline
cp .env.example .env
```

Open `.env` and fill in your AWS account ID, pick unique S3 bucket names, and paste your OpenAI key.

### 2. Build the Lambda Layer

```bash
bash lambda/layer/build_layer.sh
```

This runs a Docker container with Amazon Linux 2023, installs PyMuPDF and pdfplumber inside it, and zips everything up for Lambda. Takes about a minute.

### 3. Deploy

```bash
bash deploy/deploy.sh
```

The script creates your S3 buckets, DynamoDB table, IAM roles, Lambda functions, API Gateway, and uploads the frontend. When it finishes, it prints the dashboard URL.

### 4. Try it

1. Open the frontend URL from the deploy output
2. Drag a resume PDF onto the upload area
3. Wait about 30 seconds
4. Click the document card to see parsed results

## Project structure

```
ai-document-pipeline/
├── lambda/
│   ├── document_processor/
│   │   ├── lambda_function.py        # PDF text extraction + LLM analysis + DynamoDB write
│   │   └── requirements.txt
│   ├── results_api/
│   │   ├── lambda_function.py        # Serves data to the frontend, generates presigned URLs
│   │   └── requirements.txt
│   └── layer/
│       └── build_layer.sh            # Builds the PyMuPDF/pdfplumber Lambda Layer
├── deploy/
│   ├── deploy.sh                     # Creates all AWS resources
│   ├── teardown.sh                   # Removes all AWS resources
│   └── trust-policy.json             # IAM trust policy for Lambda
├── frontend/
│   └── index.html                    # The whole dashboard in one file
├── .env.example
├── .gitignore
└── README.md
```

## AWS services used

| Service | What it does | Free Tier limit |
|---------|-------------|-----------------|
| S3 | Stores uploaded PDFs, hosts the frontend | 5GB storage, 20K GET, 2K PUT/month |
| Lambda | Runs both processing functions | 1M requests, 400K GB-seconds/month |
| DynamoDB | Holds parsed results | 25GB, 25 read/write capacity units |
| API Gateway | Routes frontend requests to Lambda | 1M calls/month |
| SSM Parameter Store | Keeps the OpenAI key encrypted | Standard parameters are free |
| CloudWatch | Lambda logs | 5GB log ingestion/month |
| IAM | Per-function permissions | Always free |

We don't use Textract ($1.50/page). PyMuPDF does the same job for free.

## Building the Lambda Layer without Docker

If you don't have Docker, you can build the layer on any Linux box or in WSL:

```bash
pip install PyMuPDF==1.25.3 pdfplumber==0.11.4 openai==1.68.0 \
    -t lambda/layer/python/lib/python3.11/site-packages/ \
    --no-cache-dir
cd lambda/layer
zip -r9 lambda-layer.zip python/
rm -rf python/
```

The deploy script picks up `lambda-layer.zip` from there.

## Example output

Feed it a resume and you get something like:

```json
{
  "name": "Jane Smith",
  "email": "jane.smith@email.com",
  "phone": "+1-555-123-4567",
  "skills": ["Python", "AWS", "Machine Learning", "SQL", "Docker", "React"],
  "work_experience": [
    {
      "company": "Acme Corp",
      "role": "Senior Data Engineer",
      "duration": "2021 - Present",
      "highlights": [
        "Built real-time data pipeline processing 2M events/day",
        "Reduced infrastructure costs by 40% through optimization"
      ]
    }
  ],
  "education": [
    {
      "institution": "MIT",
      "degree": "M.S. Computer Science",
      "year": "2020"
    }
  ],
  "recruiter_summary": "Jane is a senior data engineer with 5+ years of experience building scalable data pipelines on AWS. Her strong combination of Python, ML, and cloud infrastructure skills makes her an excellent fit for senior IC or tech lead roles in data-intensive organizations."
}
```

## Cost at 100 documents per month

| Service | Usage | Monthly cost |
|---------|-------|-------------|
| S3 | ~50MB stored, 200 requests | $0.00 |
| Lambda | 100 heavy runs + 300 light ones | $0.00 |
| DynamoDB | 100 writes, ~300 reads | $0.00 |
| API Gateway | ~400 calls | $0.00 |
| SSM, CloudWatch, IAM | Minimal | $0.00 |
| OpenAI API | 100 calls to gpt-4o-mini | ~$0.02 |
| **Total** | | **~$0.02/month** |

All the AWS services stay inside Free Tier limits. OpenAI is the only line item and it rounds to zero at this volume.

## Tearing it down

```bash
bash deploy/teardown.sh
```

Removes everything in reverse order: API Gateway, Lambdas, the Layer, IAM roles, DynamoDB table, SSM parameter, and both S3 buckets.

## License

MIT
