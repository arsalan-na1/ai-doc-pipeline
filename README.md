# AI Document Intelligence Pipeline

A serverless, end-to-end AI document processing pipeline built entirely on AWS Free Tier. Upload a resume PDF through a web dashboard, and the system automatically extracts text, sends it to an LLM for structured analysis, and displays the parsed results — all for effectively zero cost.

## Architecture

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

## Demo Use Case: Resume Parsing

Upload a resume PDF and get back:
- **Name, email, phone** — extracted contact details
- **Skills** — listed as tags
- **Work Experience** — company, role, duration, and highlights
- **Education** — institution, degree, year
- **Recruiter Summary** — a 2-sentence AI-generated summary

## Prerequisites

- **AWS CLI** configured with credentials (`aws configure`)
- **AWS Account** with Free Tier eligibility
- **OpenAI API Key** — get one at [platform.openai.com](https://platform.openai.com)
- **Docker** — for building the Lambda Layer (or WSL on Windows)
- **Python 3.11** — for local development/testing

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_USERNAME/ai-document-pipeline.git
cd ai-document-pipeline
cp .env.example .env
# Edit .env with your values (AWS account ID, unique S3 bucket names, OpenAI key)
```

### 2. Build the Lambda Layer

```bash
bash lambda/layer/build_layer.sh
```

This uses Docker to package PyMuPDF and pdfplumber in an Amazon Linux 2023 environment compatible with AWS Lambda.

### 3. Deploy

```bash
bash deploy/deploy.sh
```

The script creates all AWS resources and outputs your frontend URL and API endpoint.

### 4. Use it

1. Open the frontend URL in your browser
2. Upload a resume PDF (drag & drop or click to browse)
3. Wait ~30 seconds for processing
4. Click the document card to view parsed results

## Project Structure

```
ai-document-pipeline/
├── README.md                         # This file
├── .env.example                      # Environment variable template
├── .gitignore
├── lambda/
│   ├── document_processor/
│   │   ├── lambda_function.py        # S3-triggered: PDF → text → LLM → DynamoDB
│   │   └── requirements.txt
│   ├── results_api/
│   │   ├── lambda_function.py        # API Gateway handler: list, get, upload URL
│   │   └── requirements.txt
│   └── layer/
│       └── build_layer.sh            # Docker-based Lambda Layer builder
├── deploy/
│   ├── deploy.sh                     # Full AWS CLI deployment (11 steps)
│   ├── teardown.sh                   # Clean removal of all resources
│   └── trust-policy.json             # IAM trust policy for Lambda
└── frontend/
    └── index.html                    # Single-file dashboard (HTML/CSS/JS)
```

## AWS Services Used

| Service | Purpose | Free Tier Limit |
|---------|---------|-----------------|
| **S3** | Document uploads + frontend hosting | 5GB storage, 20K GET, 2K PUT/month |
| **Lambda** | All processing logic (2 functions) | 1M requests, 400K GB-seconds/month |
| **DynamoDB** | Results storage | 25GB, 25 RCU/WCU |
| **API Gateway** | REST API for frontend | 1M API calls/month |
| **SSM Parameter Store** | OpenAI API key (encrypted) | Standard parameters free |
| **CloudWatch** | Lambda logging | 5GB log ingestion/month |
| **IAM** | Least-privilege roles | Always free |

**Not used (by design):** Textract ($1.50/page) — replaced with PyMuPDF (free, open source).

## Lambda Layer: Packaging PyMuPDF

The document processor Lambda needs PyMuPDF and pdfplumber, which include compiled C extensions. These must be built on Amazon Linux to work in Lambda.

### With Docker (recommended):

```bash
bash lambda/layer/build_layer.sh
```

### Without Docker (WSL or Linux):

```bash
pip install PyMuPDF==1.25.3 pdfplumber==0.11.4 openai==1.68.0 \
    -t lambda/layer/python/lib/python3.11/site-packages/ \
    --no-cache-dir
cd lambda/layer
zip -r9 lambda-layer.zip python/
rm -rf python/
```

The resulting `lambda-layer.zip` is uploaded as a Lambda Layer during deployment.

## Example Input/Output

**Input:** A standard resume PDF

**Output (JSON stored in DynamoDB):**

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

## Cost Estimate (100 documents/month)

| Service | Usage | Monthly Cost |
|---------|-------|-------------|
| S3 | ~50MB storage, 200 requests | $0.00 |
| Lambda | 100 processor (60s, 512MB) + 300 API (10s, 128MB) | $0.00 |
| DynamoDB | 100 writes, ~300 reads | $0.00 |
| API Gateway | ~400 calls | $0.00 |
| SSM Parameter Store | Standard tier | $0.00 |
| CloudWatch Logs | ~10MB | $0.00 |
| **OpenAI API** | 100 calls, gpt-4o-mini (~2K tokens each) | **~$0.02** |
| **Total** | | **~$0.02/month** |

All AWS services stay well within Free Tier limits. The only cost is OpenAI API usage, which is negligible at portfolio-level traffic.

## Teardown

Remove all AWS resources:

```bash
bash deploy/teardown.sh
```

This deletes everything in reverse order: API Gateway, Lambdas, Layer, IAM role, DynamoDB table, SSM parameter, and both S3 buckets.

## License

MIT
