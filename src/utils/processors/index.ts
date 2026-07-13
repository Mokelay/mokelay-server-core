import { apiJsonWhenPublishedProcessor } from './api_json_when_published.js'
import { booleanValueProcessor } from './boolean_value.js'
import { defaultValueProcessor } from './default_value.js'
import { emailCheckProcessor } from './email_check.js'
import { envValueProcessor } from './env_value.js'
import { eqProcessor } from './eq.js'
import { equalsProcessor } from './equals.js'
import { hashCheckProcessor } from './hash_check.js'
import { hashMakeProcessor } from './hash_make.js'
import { isNotNullProcessor } from './is_not_null.js'
import { isNullProcessor } from './is_null.js'
import { maxProcessor } from './max.js'
import { minProcessor } from './min.js'
import { notNullProcessor } from './not_null.js'
import { numberCheckProcessor } from './number_check.js'
import { regexProcessor } from './regex.js'
import { stringArrayCheckProcessor } from './string_array_check.js'
import { trimProcessor } from './trim.js'
import { type ProcessorExecutor } from './shared.js'

export const processorExecutors: Record<string, ProcessorExecutor> = {
  trim: trimProcessor,
  is_not_null: isNotNullProcessor,
  is_null: isNullProcessor,
  not_null: notNullProcessor,
  email_check: emailCheckProcessor,
  number_check: numberCheckProcessor,
  eq: eqProcessor,
  equals: equalsProcessor,
  default_value: defaultValueProcessor,
  env_value: envValueProcessor,
  api_json_when_published: apiJsonWhenPublishedProcessor,
  boolean_value: booleanValueProcessor,
  min: minProcessor,
  max: maxProcessor,
  regex: regexProcessor,
  string_array_check: stringArrayCheckProcessor,
  hash_make: hashMakeProcessor,
  hash_check: hashCheckProcessor,
}
