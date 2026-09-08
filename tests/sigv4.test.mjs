// SigV4 签名回归测试：AWS 官方参考测试套件向量（s3-get-object / s3-put-object）
// 签名原语由 cloud-transports.js 对外提供，避免把 server.js 重新变成实现宿主。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCloudTransports } = require('../server/cloud-transports.js');
const { s3Sha256hex, s3Hmac } = createCloudTransports({
  fetchImpl: async () => { throw new Error('network should not be used by SigV4 vector tests'); }
});

// 官方参考套件密钥（文档示例值，非真实凭据）
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const AMZ_DATE = '20130524T000000Z';
const DATE_STAMP = '20130524';
const REGION = 'us-east-1';
const SCOPE = DATE_STAMP + '/' + REGION + '/s3/aws4_request';

function deriveSigningKey() {
  const kDate = s3Hmac('AWS4' + SECRET, DATE_STAMP);
  const kRegion = s3Hmac(kDate, REGION);
  const kService = s3Hmac(kRegion, 's3');
  return s3Hmac(kService, 'aws4_request');
}

function sign(canonicalRequest) {
  const stringToSign = ['AWS4-HMAC-SHA256', AMZ_DATE, SCOPE, s3Sha256hex(canonicalRequest)].join('\n');
  return crypto.createHmac('sha256', deriveSigningKey()).update(stringToSign).digest('hex');
}

test('SigV4 官方向量: GET Object (test.txt + Range)', () => {
  const payloadHash = s3Sha256hex('');
  const headers = {
    'host': 'examplebucket.s3.amazonaws.com',
    'range': 'bytes=0-9',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': AMZ_DATE
  };
  const canonicalHeaders = Object.keys(headers).sort().map(k => k + ':' + headers[k]).join('\n') + '\n';
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalRequest = ['GET', '/test.txt', '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  assert.equal(sign(canonicalRequest), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('SigV4 官方向量: PUT Object (test$file.text + body)', () => {
  const bodyHash = s3Sha256hex('Welcome to Amazon S3.');
  const headers = {
    'date': 'Fri, 24 May 2013 00:00:00 GMT',
    'host': 'examplebucket.s3.amazonaws.com',
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': AMZ_DATE,
    'x-amz-storage-class': 'REDUCED_REDUNDANCY'
  };
  const canonicalHeaders = Object.keys(headers).sort().map(k => k + ':' + headers[k]).join('\n') + '\n';
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalRequest = ['PUT', '/test%24file.text', '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
  assert.equal(sign(canonicalRequest), '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});
