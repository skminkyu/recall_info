import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const ProductAnalysisSchema = z.object({
  category: z.string().nullable(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  colors: z.array(z.string()),
  markings: z.array(z.string()),
  keywords: z.array(z.string()),
  confidence: z.number(),
});

export type ProductAnalysis = z.infer<typeof ProductAnalysisSchema>;

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const PROMPT = `이 사진은 사용자가 업로드한 실제 생활 속 제품 사진입니다. 사진에 보이는 제품을 분석해서 아래 항목에 맞게 답하세요.

- category: 제품 카테고리 (예: 전기포트, 가습기, 완구, 모기 포집기 등), 한국어로
- name: 제품명 또는 제품 유형을 나타내는 짧은 이름
- brand: 라벨/각인 등에서 브랜드명이 보이면 기입, 안 보이면 null
- model: 모델명/모델번호가 보이면 기입, 안 보이면 null
- colors: 주요 색상 목록. "다크그린"처럼 수식어를 붙이지 말고 "그린", "화이트", "블랙",
  "레드", "블루", "옐로우", "핑크", "그레이", "브라운" 등 기본 색상 단어로 (최대 3개)
- markings: 라벨, 로고, 각인된 문구 등 사진에서 읽을 수 있는 모든 텍스트
- keywords: 이 제품과 유사한 리콜 제품을 검색할 때 쓸 수 있는 한국어/영어 키워드 5~10개 (제품군, 용도, 형태 포함)
- confidence: 0~1 사이, 이 분석에 대한 전반적 확신도

사진에 실제로 보이는 내용만 근거로 답하고, 보이지 않는 정보는 null 또는 빈 배열로 두세요.`;

function detectMediaType(filePath: string): string {
  return MEDIA_TYPE_BY_EXT[path.extname(filePath).toLowerCase()] ?? "image/jpeg";
}

export async function analyzeProductImage(imagePath: string): Promise<ProductAnalysis> {
  const client = new Anthropic();
  const imageData = fs.readFileSync(imagePath).toString("base64");
  const mediaType = detectMediaType(imagePath);

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 2048,
    output_config: {
      format: zodOutputFormat(ProductAnalysisSchema),
      effort: "medium",
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as "image/jpeg", data: imageData },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error("이미지 분석 결과를 파싱하지 못했습니다.");
  }
  return response.parsed_output;
}
