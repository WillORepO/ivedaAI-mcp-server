# Tool reference

> Auto-generated from `resources/openapi.json` by `npm run docs` — do not edit by hand. See [USAGE.md](USAGE.md) for how to call these tools.

This server exposes **63 resource tools** plus `ivedaai_get_schema`, `ivedaai_alert_integration`, and `ivedaai_add_camera`. Each resource tool dispatches to one of its listed operations via the `operation` argument.

## Index

| Tool | Operations | Read-only |
|---|---|---|
| [`ivedaai_account`](#ivedaai_account) | 14 | no |
| [`ivedaai_ainvr`](#ivedaai_ainvr) | 10 | no |
| [`ivedaai_alert`](#ivedaai_alert) | 10 | no |
| [`ivedaai_alert_rule`](#ivedaai_alert_rule) | 9 | no |
| [`ivedaai_alert_trigger`](#ivedaai_alert_trigger) | 2 | no |
| [`ivedaai_analytic_config`](#ivedaai_analytic_config) | 5 | no |
| [`ivedaai_audit_trail`](#ivedaai_audit_trail) | 2 | no |
| [`ivedaai_authentication`](#ivedaai_authentication) | 1 | no |
| [`ivedaai_brand`](#ivedaai_brand) | 1 | yes |
| [`ivedaai_camera`](#ivedaai_camera) | 14 | no |
| [`ivedaai_camera_state`](#ivedaai_camera_state) | 1 | yes |
| [`ivedaai_camera_group`](#ivedaai_camera_group) | 8 | no |
| [`ivedaai_cloud_storage`](#ivedaai_cloud_storage) | 9 | no |
| [`ivedaai_configuration`](#ivedaai_configuration) | 4 | no |
| [`ivedaai_counting`](#ivedaai_counting) | 2 | yes |
| [`ivedaai_detection`](#ivedaai_detection) | 10 | no |
| [`ivedaai_dwell_history`](#ivedaai_dwell_history) | 1 | yes |
| [`ivedaai_engine_model`](#ivedaai_engine_model) | 7 | no |
| [`ivedaai_engine_object`](#ivedaai_engine_object) | 1 | yes |
| [`ivedaai_engine_profile`](#ivedaai_engine_profile) | 6 | no |
| [`ivedaai_event`](#ivedaai_event) | 5 | no |
| [`ivedaai_external_camera`](#ivedaai_external_camera) | 3 | no |
| [`ivedaai_face`](#ivedaai_face) | 6 | no |
| [`ivedaai_face_category`](#ivedaai_face_category) | 5 | no |
| [`ivedaai_face_match`](#ivedaai_face_match) | 5 | no |
| [`ivedaai_face_target`](#ivedaai_face_target) | 15 | no |
| [`ivedaai_false_report`](#ivedaai_false_report) | 2 | no |
| [`ivedaai_filter`](#ivedaai_filter) | 5 | no |
| [`ivedaai_footage`](#ivedaai_footage) | 5 | no |
| [`ivedaai_gateway`](#ivedaai_gateway) | 5 | no |
| [`ivedaai_hashtag`](#ivedaai_hashtag) | 4 | no |
| [`ivedaai_identity_recognition`](#ivedaai_identity_recognition) | 4 | no |
| [`ivedaai_image`](#ivedaai_image) | 1 | no |
| [`ivedaai_indoor_map`](#ivedaai_indoor_map) | 10 | no |
| [`ivedaai_job`](#ivedaai_job) | 11 | no |
| [`ivedaai_license`](#ivedaai_license) | 6 | no |
| [`ivedaai_license_plate`](#ivedaai_license_plate) | 5 | no |
| [`ivedaai_license_plate_category`](#ivedaai_license_plate_category) | 6 | no |
| [`ivedaai_license_plate_target`](#ivedaai_license_plate_target) | 7 | no |
| [`ivedaai_line_set`](#ivedaai_line_set) | 6 | no |
| [`ivedaai_make_model`](#ivedaai_make_model) | 1 | yes |
| [`ivedaai_media`](#ivedaai_media) | 1 | no |
| [`ivedaai_module`](#ivedaai_module) | 5 | no |
| [`ivedaai_multi_factor_authentication`](#ivedaai_multi_factor_authentication) | 1 | no |
| [`ivedaai_nvr`](#ivedaai_nvr) | 11 | no |
| [`ivedaai_oauth`](#ivedaai_oauth) | 1 | no |
| [`ivedaai_object_type`](#ivedaai_object_type) | 3 | yes |
| [`ivedaai_onvif`](#ivedaai_onvif) | 2 | no |
| [`ivedaai_openid`](#ivedaai_openid) | 3 | no |
| [`ivedaai_password`](#ivedaai_password) | 4 | no |
| [`ivedaai_plugin`](#ivedaai_plugin) | 4 | no |
| [`ivedaai_resource`](#ivedaai_resource) | 4 | no |
| [`ivedaai_roi`](#ivedaai_roi) | 6 | no |
| [`ivedaai_scene`](#ivedaai_scene) | 10 | no |
| [`ivedaai_scene_object`](#ivedaai_scene_object) | 4 | no |
| [`ivedaai_sound`](#ivedaai_sound) | 4 | no |
| [`ivedaai_sse`](#ivedaai_sse) | 1 | yes |
| [`ivedaai_statistic`](#ivedaai_statistic) | 1 | yes |
| [`ivedaai_streaming`](#ivedaai_streaming) | 2 | yes |
| [`ivedaai_time`](#ivedaai_time) | 1 | yes |
| [`ivedaai_tracking`](#ivedaai_tracking) | 1 | no |
| [`ivedaai_user_group`](#ivedaai_user_group) | 12 | no |
| [`ivedaai_utility`](#ivedaai_utility) | 1 | no |

## ivedaai_account

#### `DELETE /api/accounts` — Delete accounts in batch

**Body:** `array of integer`

#### `GET /api/accounts` — List accounts

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `nameContains` | query | no | string | nameContains. |
| `userGroupId` | query | no | string | userGroupId. |
| `userGroupNameContains` | query | no | string | userGroupNameContains. |
| `authenticationTypes` | query | no | string | authenticationTypes. — one of: Ldap, Local, OpenID |
| `excludeSupremeAdmin` | query | no | boolean | excludeSupremeAdmin. |

#### `POST /api/accounts` — Create account

**Body:** `{ activeUserSelfManagementMfa?:boolean, authenticationType?:enum(Ldap|Local|OpenID), email*:string, expirationDate?:string(yyyy-MM-dd), isActive?:boolean, locale*:string, multiFactorAuthenticationType?:enum[](EmailOtp|OFF), name*:string, note?:string, password*:string, preferenceConfig?:PreferenceConfig, showExpirationNotice?:boolean, showTermsConditions?:boolean, userGroupId*:string }`

#### `DELETE /api/accounts/{accountId}` — Delete account by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `accountId` | path | **yes** | integer | accountId. |

#### `GET /api/accounts/{accountId}` — Find account by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `accountId` | path | **yes** | integer | accountId. |

#### `PATCH /api/accounts/{accountId}` — Patch account

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `accountId` | path | **yes** | integer | accountId. |

**Body:** `{ activeUserSelfManagementMfa?:boolean, authenticationType?:enum(Ldap|Local|OpenID), email*:string, expirationDate?:string(yyyy-MM-dd), isActive?:boolean, locale*:string, multiFactorAuthenticationType?:enum[](EmailOtp|OFF), name*:string, note?:string, password*:string, preferenceConfig?:PreferenceConfig, showExpirationNotice?:boolean, showTermsConditions?:boolean, userGroupId*:string }`

> ⚠️ NOTE: GET /api/accounts/{accountId} returns this field under a different key — userGroupId → userGroup.userGroupId. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it.

#### `PUT /api/accounts/{accountId}` — Update account

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `accountId` | path | **yes** | integer | accountId. |

**Body:** `{ activeUserSelfManagementMfa?:boolean, authenticationType?:enum(Ldap|Local|OpenID), email*:string, expirationDate?:string(yyyy-MM-dd), isActive?:boolean, locale*:string, multiFactorAuthenticationType?:enum[](EmailOtp|OFF), name*:string, note?:string, password*:string, preferenceConfig?:PreferenceConfig, showExpirationNotice?:boolean, showTermsConditions?:boolean, userGroupId*:string }`

> ⚠️ NOTE: GET /api/accounts/{accountId} returns this field under a different key — userGroupId → userGroup.userGroupId. This endpoint refuses partial bodies outright, so the full object is required regardless.

#### `GET /api/accounts/{accountId}/permissions` — List account permissions

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `accountId` | path | **yes** | integer | accountId. |
| `type` | query | no | string | type. — one of: Camera, FaceCategory, LicensePlateCategory |

#### `DELETE /api/accounts/api-keys` — Delete API key in batch

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `apiKeyIds` | query | **yes** | string | apiKeyIds. |

#### `GET /api/accounts/api-keys` — Find all API keys for the account

_No parameters._

#### `POST /api/accounts/api-keys` — Create API key for the specific account

**Body:** `{ isActive*:boolean, name?:string }`

#### `DELETE /api/accounts/api-keys/{keyId}` — Delete API key

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `keyId` | path | **yes** | string | keyId. |

#### `PATCH /api/accounts/api-keys/{keyId}` — Patch API key

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `keyId` | path | **yes** | string | keyId. |

**Body:** `{ isActive*:boolean, name?:string }`

#### `GET /api/accounts/findByName` — Find account by name

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `accountName` | query | **yes** | string | accountName. |

## ivedaai_ainvr

#### `DELETE /api/ainvrs` — Delete ainvrs in batch

**Body:** `array of integer`

#### `GET /api/ainvrs` — List Ainvrs

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |

#### `POST /api/ainvrs` — Create Ainvr

**Body:** `{ host*:string, name*:string, password*:string, port*:integer, scheme*:enum(http|https), username*:string }`

#### `PUT /api/ainvrs` — Sync Cluster(s) by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | **yes** | integer | ainvrIds. |
| `notify` | query | no | boolean | notify. |

#### `DELETE /api/ainvrs/{ainvrId}` — Delete ainvr by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | path | **yes** | integer | ainvrId. |

#### `GET /api/ainvrs/{ainvrId}` — Find Ainvr by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | path | **yes** | integer | ainvrId. |

#### `PATCH /api/ainvrs/{ainvrId}` — patch Ainvr

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | path | **yes** | integer | ainvrId. |

**Body:** `{ host*:string, name*:string, password*:string, port*:integer, scheme*:enum(http|https), username*:string }`

#### `PUT /api/ainvrs/{ainvrId}` — Update Ainvr

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | path | **yes** | integer | ainvrId. |

**Body:** `{ host*:string, name*:string, password*:string, port*:integer, scheme*:enum(http|https), username*:string }`

#### `PUT /api/ainvrs/{ainvrId}/cameras` — Sync Ainvr Cameras

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | path | **yes** | integer | ainvrId. |

#### `POST /api/ainvrs/validate` — Check Ainvr connection

**Body:** `{ host*:string, name*:string, password*:string, port*:integer, scheme*:enum(http|https), username*:string }`

## ivedaai_alert

#### `DELETE /api/alerts` — Delete alerts in batch

**Body:** `array of integer`

#### `GET /api/alerts` — Find alerts

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `end` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `timezone` | query | no | string | client timezone. |
| `ainvrIds` | query | no | integer | seperated ainvr ids with comma. |
| `cameraIds` | query | no | integer | seperated camera ids with comma. |
| `alertRuleIds` | query | no | string | seperated alert rule ids with comma. |
| `alertTypes` | query | no | string | seperated event types with comma. — one of: CAMERA_ABNORMAL, CROWD_DETECTION, DWELL, FACE_RECOGNITION, FALL, INTRUSION, LPR, OBJECT_COUNTING, OBJECT_LEFT_BEHIND, OBJECT_WRONG_DIRECTION, SCENE_CHANGE, VIDEO_SEARCH |
| `states` | query | no | string | seperated state ids with comma. — one of: InProgress, Resolved, Unresolved |

> ⚠️ NOTE: on an active deployment this collection is very large — hundreds of thousands of records over a week is normal — so it cannot be read through to answer a question about it. To count, send the filters you care about with size=1 (not 0, which is ignored for a default page) and read pagination.total: that is an exact figure for well under a kilobyte, and start/end, alertTypes, states, cameraIds and alertRuleIds all combine. Repeat it per value to break a total down. Use GET /api/alerts/latest for what is happening now rather than paging this one from the start.

#### `PUT /api/alerts` — Chage alert state

**Body:** `{ alertIds*:integer[], state*:enum(InProgress|Resolved|Unresolved) }`

#### `POST /api/alerts/_search` — Search alerts

**Body:** `{ ainvrIds?:integer[], alertRuleIds?:string[], alertTypes?:enum[](CAMERA_ABNORMAL|CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|HUMAN_ATTRIBUTE|IDENTITY_RECOGNITION|ILLEGAL_PARKING|+16 more), allCameras?:boolean, audit?:boolean, cameraIds?:integer[], end?:string, page?:integer, pairs?:AlertWithCamera[], size?:integer, sort?:string[], start?:string, states?:enum[](InProgress|Resolved|Unresolved) }`

#### `DELETE /api/alerts/{alertId}` — Delete alert by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `alertId` | path | **yes** | integer | alertId. |

#### `GET /api/alerts/{alertId}` — Get alert details

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `alertId` | path | **yes** | integer | alertId. |

#### `GET /api/alerts/latest` — Find latest alerts

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `size` | query | no | integer | latest n records. |
| `ainvrIds` | query | no | integer | seperated ainvr ids with comma. |
| `alertRuleIds` | query | no | string | seperated alert rule ids with comma. |
| `cameraIds` | query | no | integer | seperated camera ids with comma. |
| `alertTypes` | query | no | string | seperated event types with comma. — one of: CAMERA_ABNORMAL, CROWD_DETECTION, DWELL, FACE_RECOGNITION, FALL, INTRUSION, LPR, OBJECT_COUNTING, OBJECT_LEFT_BEHIND, OBJECT_WRONG_DIRECTION, SCENE_CHANGE, VIDEO_SEARCH |
| `states` | query | no | string | seperated state ids with comma. — one of: InProgress, Resolved, Unresolved |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |

#### `POST /api/alerts/latest` — Query latest alerts

**Body:** `{ ainvrIds?:integer[], alertRuleIds?:string[], alertTypes?:enum[](CAMERA_ABNORMAL|CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|HUMAN_ATTRIBUTE|IDENTITY_RECOGNITION|ILLEGAL_PARKING|+16 more), allCameras?:boolean, audit?:boolean, cameraIds?:integer[], end?:string, page?:integer, pairs?:AlertWithCamera[], size?:integer, sort?:string[], start?:string, states?:enum[](InProgress|Resolved|Unresolved) }`

#### `POST /api/alerts/pairs` — Find alerts with rule with camera pars

**Body:** `{ alertWithCameras?:AlertWithCamera[], end?:string, page?:integer, size?:integer, start?:string, timezone?:string }`

#### `POST /api/alerts/statistics` — Get alert statistics

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `by` | query | **yes** | string | by. — one of: camera, day, hour, minute, month, rule, state, type |

**Body:** `{ ainvrIds?:integer[], alertRuleIds?:string[], alertTypes?:enum[](CAMERA_ABNORMAL|CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|HUMAN_ATTRIBUTE|IDENTITY_RECOGNITION|ILLEGAL_PARKING|+16 more), allCameras?:boolean, audit?:boolean, cameraIds?:integer[], end?:string, page?:integer, pairs?:AlertWithCamera[], size?:integer, sort?:string[], start?:string, states?:enum[](InProgress|Resolved|Unresolved) }`

## ivedaai_alert_rule

#### `DELETE /api/alertRules` — Delete alert rules in batch

**Body:** `array of string`

#### `GET /api/alertRules` — Find alert rules

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `ainvrIds` | query | no | integer | seperated ainvr ids with comma. |
| `cameraIds` | query | no | integer | seperated camera ids with comma. |
| `name` | query | no | string | Partial match string. |
| `camName` | query | no | string | Partial match string. |
| `eventTypes` | query | no | string | Alert Event Type. — one of: CAMERA_ABNORMAL, CROWD_DETECTION, DWELL, FACE_RECOGNITION, FALL, INTRUSION, LPR, OBJECT_COUNTING, OBJECT_LEFT_BEHIND, OBJECT_WRONG_DIRECTION, SCENE_CHANGE, VIDEO_SEARCH |

#### `POST /api/alertRules` — Create alert rule

**Body:** `{ abnormalTypes?:enum[](Abnormal|Disconnect|Normal|ResolutionChange), alertType?:enum(CAMERA_ABNORMAL|CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|INTRUSION|LPR|OBJECT_COUNTING|+4 more), cameraIds?:integer[], cooldownInterval?:integer, countingRule?:CountingRule, description?:string, enableForever?:boolean, faceCategoryIds?:string[], hashtags?:string[], idrAccess?:enum(All|Denied|Granted), isEnabled?:boolean, lineIds?:integer[], lprCategoryIds?:string[], lprTypes?:LPRType[], name?:string, personTypes?:PersonType[], roiIds?:integer[], roiTypes?:RoiTypeReq[], trigger?:AlertTrigger, typeLogic?:enum(and|or), weekdays?:Weekday[] }`

#### `DELETE /api/alertRules/{alertRuleId}` — Delete alert rule by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `alertRuleId` | path | **yes** | string | alertRuleId. |

#### `GET /api/alertRules/{alertRuleId}` — Find alert rule by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `alertRuleId` | path | **yes** | string | alertRuleId. |

#### `PATCH /api/alertRules/{alertRuleId}` — Patch alert rule

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `alertRuleId` | path | **yes** | string | alertRuleId. |

**Body:** `{ abnormalTypes?:enum[](Abnormal|Disconnect|Normal|ResolutionChange), alertType?:enum(CAMERA_ABNORMAL|CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|INTRUSION|LPR|OBJECT_COUNTING|+4 more), cameraIds?:integer[], cooldownInterval?:integer, countingRule?:CountingRule, description?:string, enableForever?:boolean, faceCategoryIds?:string[], hashtags?:string[], idrAccess?:enum(All|Denied|Granted), isEnabled?:boolean, lineIds?:integer[], lprCategoryIds?:string[], lprTypes?:LPRType[], name?:string, personTypes?:PersonType[], roiIds?:integer[], roiTypes?:RoiTypeReq[], trigger?:AlertTrigger, typeLogic?:enum(and|or), weekdays?:Weekday[] }`

> ⚠️ NOTE: GET /api/alertRules/{alertRuleId} returns these fields under a different key — cameraIds → condition (JSON string).cameras, cooldownInterval → condition (JSON string).cooldownInterval, enableForever → schedule.forever, hashtags → condition (JSON string).hashtags, name → alertName, roiIds → condition (JSON string).roiIds, typeLogic → condition (JSON string).typeLogic, weekdays → schedule.weekdays. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it. NOTE: "abnormalTypes", "countingRule", "faceCategoryIds", "idrAccess", "lineIds", "lprCategoryIds", "lprTypes", "personTypes", "roiTypes" have no known equivalent in GET /api/alertRules/{alertRuleId}, so they cannot be read back — but this endpoint keeps omitted fields, so they survive an update that leaves them out.

#### `PUT /api/alertRules/{alertRuleId}` — Update alert rule

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `alertRuleId` | path | **yes** | string | alertRuleId. |

**Body:** `{ abnormalTypes?:enum[](Abnormal|Disconnect|Normal|ResolutionChange), alertType?:enum(CAMERA_ABNORMAL|CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|INTRUSION|LPR|OBJECT_COUNTING|+4 more), cameraIds?:integer[], cooldownInterval?:integer, countingRule?:CountingRule, description?:string, enableForever?:boolean, faceCategoryIds?:string[], hashtags?:string[], idrAccess?:enum(All|Denied|Granted), isEnabled?:boolean, lineIds?:integer[], lprCategoryIds?:string[], lprTypes?:LPRType[], name?:string, personTypes?:PersonType[], roiIds?:integer[], roiTypes?:RoiTypeReq[], trigger?:AlertTrigger, typeLogic?:enum(and|or), weekdays?:Weekday[] }`

> ⚠️ NOTE: GET /api/alertRules/{alertRuleId} returns these fields under a different key — cameraIds → condition (JSON string).cameras, cooldownInterval → condition (JSON string).cooldownInterval, enableForever → schedule.forever, hashtags → condition (JSON string).hashtags, name → alertName, roiIds → condition (JSON string).roiIds, typeLogic → condition (JSON string).typeLogic, weekdays → schedule.weekdays. This endpoint refuses partial bodies outright, so the full object is required regardless. NOTE: "abnormalTypes", "countingRule", "faceCategoryIds", "idrAccess", "lineIds", "lprCategoryIds", "lprTypes", "personTypes", "roiTypes" have no known equivalent in GET /api/alertRules/{alertRuleId}, so they cannot be read back — but this endpoint refuses partial bodies, so an update omitting them fails rather than resetting anything.

#### `GET /api/alertRules/types` — Find alert rule types

_No parameters._

#### `GET /api/alertTypes` — Find alert rule types

_No parameters._

## ivedaai_alert_trigger

#### `GET /api/alert-triggers/metadata` — Get alert trigger metadata

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `view` | query | no | string | view. — one of: All, Fr, Id, Lpr, Pc, Post, Vc |

#### `POST /api/alertTriggers` — Test alert triggers

**Body:** `{ trigger?:AlertTrigger }`

## ivedaai_analytic_config

#### `GET /api/analytic-configs` — Find analytic configs

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | query | **yes** | integer | cameraId. |
| `engines` | query | no | string | engines. |

#### `POST /api/analytic-configs` — Create analytic config

**Body:** `{ cameraId*:integer, config*:JsonObject, engine*:string }`

#### `DELETE /api/analytic-configs/{configId}` — Delete analytic config

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `configId` | path | **yes** | integer | configId. |

#### `GET /api/analytic-configs/{configId}` — Find analytic config

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `configId` | path | **yes** | integer | configId. |

#### `PATCH /api/analytic-configs/{configId}` — Update analytic config

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `configId` | path | **yes** | integer | configId. |

**Body:** `{ cameraId*:integer, config*:JsonObject, engine*:string }`

## ivedaai_audit_trail

#### `GET /api/auditTrails` — Find audit trails

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `end` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `accountName` | query | no | string | account name. |
| `accountIds` | query | no | integer | seperated account ids with comma. |
| `keyword` | query | no | string | search by keyword. |
| `sourceIp` | query | no | string | search by source IP. |
| `action` | query | no | string | String. — one of: ACTIVATE, ADD, BATCH_DELETE, CANCEL, DEACTIVATE, DELETE, DISABLE, DOWNLOAD, EDIT, ENABLE, EXPORT, EXPORT_HW_INFO, GRANT_PERMISSION, IMPORT, LOGIN, LOGOUT, NETWORK, QUERY, RENEW_LICENSE, RESTART, RETRIEVE, SETTING, SHUTDOWN, SWITCH, SYNC_CAMERA, UPGRADE, UPLOAD, USE |

#### `POST /api/auditTrails` — create audit trails

**Body:** `{ action*:enum(ACTIVATE|ADD|BATCH_DELETE|CANCEL|DEACTIVATE|DELETE|DISABLE|DOWNLOAD|+20 more), message*:string, objectId?:integer, objectType*:string }`

## ivedaai_authentication

#### `POST /api/auth` — Get X-Auth-Token

**Body:** `{ password?:string, username?:string }`

## ivedaai_brand

#### `GET /api/brands` — List brands

_No parameters._

## ivedaai_camera

#### `DELETE /api/cameras` — Delete cameras in batch

**Body:** `array of integer`

#### `GET /api/cameras` — Find cameras

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `ainvrId` | query | no | integer | integer. |
| `name` | query | no | string | Exact string match. |
| `nameContains` | query | no | string | Partial match string. |
| `cameraTypes` | query | no | string | camera type. — one of: App, External, Footage, General, Onvif, RecordedAnalytic, VideoSource |
| `isLocal` | query | no | boolean | Boolean. |
| `latitude` | query | no | number | latitude. |
| `longitude` | query | no | number | longitude. |
| `isActivate` | query | no | boolean | Boolean. |
| `plugins` | query | no | string | plugin has any. |
| `pluginsAll` | query | no | string | plugin has all. |
| `floorPlanId` | query | no | string | uuid. |
| `cameraIds` | query | no | integer | seperated camera ids with comma. |
| `cameraGroupIds` | query | no | string | seperated camera group uuids with comma. |
| `groupNameContains` | query | no | string | Partial match string. |
| `fetchCameraGroups` | query | no | boolean | Boolean. |

> ⚠️ NOTE: isActivate filters on whether a camera is actively processing. The camera record carries no activation field, so "status" ("Processing" when active, "Idle" when not) is the per-record signal. To change it, use POST /api/cameras/{cameraId}/jobs with activate=true|false.

#### `POST /api/cameras` — Create camera

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | query | no | integer | integer. |

**Body:** `{ account?:string, cameraType*:enum(App|External|Footage|General|Onvif|RecordedAnalytic|VideoSource), description?:string, detectionMode?:string, doRecording*:boolean, engineConfig?:EngineConfig, engineProfileId*:integer, externalMeta?:ExternalMeta, floorPlanAngle?:integer, floorPlanId?:string, floorPlanX?:number, floorPlanY?:number, frameRate?:number, gpuId?:integer, hwDecode?:boolean, ip?:string, latitude?:number, locationType?:enum(GPS_MAP|INDOOR_MAP|NONE), longitude?:number, manufacturer?:string, model?:string, name?:string, nvrChannel?:string, nvrId?:string, password?:string, plugins?:enum(AgeGenderClassifier|CrossCameraTrackingEngine|CrowdDetectionEngine|DwellEngine|ExtraAlertTrigger|FaceGdpr|FaceRecognitionEngine|HumanAttributeEngine|+17 more), port?:integer, protocol*:enum(Both|TCP|UDP), resolution?:string, roiContour*:VoContour[], schedule?:Schedule, streamUrl?:string }`

> ⚠️ NOTE: the required list above is corrected — the published spec marks only "cameraType", and a body carrying just that is refused with a 400 naming the other four and no record created. Creating the record does not start the camera either; it stays Idle until activated. For onboarding a real camera prefer the ivedaai_add_camera tool, which supplies these and the other defaults, activates the camera, and reports uncertain partial creation for inspection before retrying.

#### `DELETE /api/cameras/{cameraId}` — Delete camera by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |

> ⚠️ NOTE: deleting a camera that is currently active does nothing at all, and the response does not say so — an ignored delete and a real one both answer 202 with an empty body. Measured: an "Idle" camera was gone about 2 seconds later, a "Processing" one was still there, still Processing, after 41. Deactivate first with POST /api/cameras/{cameraId}/jobs?activate=false, then poll GET /api/cameras/{cameraId} until its status is "Idle" before calling this DELETE. Deletion is asynchronous too: poll that GET until it answers 404 Not Found rather than trusting the 202 — it is 202 Accepted, not 204, so it promises nothing about having happened.

#### `GET /api/cameras/{cameraId}` — Find camera by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |

#### `PATCH /api/cameras/{cameraId}` — Patch cameara

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |

**Body:** `{ account?:string, cameraType*:enum(App|External|Footage|General|Onvif|RecordedAnalytic|VideoSource), description?:string, detectionMode?:string, doRecording*:boolean, engineConfig?:EngineConfig, engineProfileId*:integer, externalMeta?:ExternalMeta, floorPlanAngle?:integer, floorPlanId?:string, floorPlanX?:number, floorPlanY?:number, frameRate?:number, gpuId?:integer, hwDecode?:boolean, ip?:string, latitude?:number, locationType?:enum(GPS_MAP|INDOOR_MAP|NONE), longitude?:number, manufacturer?:string, model?:string, name?:string, nvrChannel?:string, nvrId?:string, password?:string, plugins?:enum(AgeGenderClassifier|CrossCameraTrackingEngine|CrowdDetectionEngine|DwellEngine|ExtraAlertTrigger|FaceGdpr|FaceRecognitionEngine|HumanAttributeEngine|+17 more), port?:integer, protocol*:enum(Both|TCP|UDP), resolution?:string, roiContour*:VoContour[], schedule?:Schedule, streamUrl?:string }`

> ⚠️ NOTE: GET /api/cameras/{cameraId} returns this field under a different key — nvrId → nvr.nvrId. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it. NOTE: "doRecording", "engineConfig" have no known equivalent in GET /api/cameras/{cameraId}, so they cannot be read back — but this endpoint keeps omitted fields, so they survive an update that leaves them out.

#### `PUT /api/cameras/{cameraId}` — Update cameara

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |

**Body:** `{ account?:string, cameraType*:enum(App|External|Footage|General|Onvif|RecordedAnalytic|VideoSource), description?:string, detectionMode?:string, doRecording*:boolean, engineConfig?:EngineConfig, engineProfileId*:integer, externalMeta?:ExternalMeta, floorPlanAngle?:integer, floorPlanId?:string, floorPlanX?:number, floorPlanY?:number, frameRate?:number, gpuId?:integer, hwDecode?:boolean, ip?:string, latitude?:number, locationType?:enum(GPS_MAP|INDOOR_MAP|NONE), longitude?:number, manufacturer?:string, model?:string, name?:string, nvrChannel?:string, nvrId?:string, password?:string, plugins?:enum(AgeGenderClassifier|CrossCameraTrackingEngine|CrowdDetectionEngine|DwellEngine|ExtraAlertTrigger|FaceGdpr|FaceRecognitionEngine|HumanAttributeEngine|+17 more), port?:integer, protocol*:enum(Both|TCP|UDP), resolution?:string, roiContour*:VoContour[], schedule?:Schedule, streamUrl?:string }`

> ⚠️ NOTE: GET /api/cameras/{cameraId} returns this field under a different key — nvrId → nvr.nvrId. This endpoint refuses partial bodies outright, so the full object is required regardless. NOTE: "doRecording", "engineConfig" have no known equivalent in GET /api/cameras/{cameraId}, so they cannot be read back — but this endpoint refuses partial bodies, so an update omitting them fails rather than resetting anything.

#### `POST /api/cameras/{cameraId}/jobs` — Operate jobs by camera id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |
| `activate` | query | **yes** | boolean | activate. |

> ⚠️ NOTE: this is how a camera is activated and deactivated. activate=true starts analytics processing, activate=false stops it. The camera's "status" becomes "Processing" or "Idle" within about a second, and the deployment records an ACTIVATE/DEACTIVATE audit entry. There is no activation field on the camera record — read the current state from "status", or with GET /api/cameras?isActivate=true|false. The two directions do not behave alike, so check "status" before calling either: activate=true on a camera that is already active answers 200 but cancels its running job and starts a new one, which interrupts analytics; activate=false on a camera that is already idle answers 400 "Camera is not active". Both matter when setting several cameras at once. Activation is also capped by licence: once the deployment is at its limit, activate=true fails with 400 errorCode 305, "Number of active cameras has reached the maximum allowed" — a full deployment, not a bad request, so the fix is to deactivate another camera rather than to retry or to change the arguments.

#### `GET /api/cameras/{cameraId}/rva-heatmap` — Get RVA heatmap

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |
| `from` | query | no | string | Start of the window, inclusive (yyyy-MM-dd). Defaults to retention period before 'to'.. |
| `to` | query | no | string | End of the window, exclusive (yyyy-MM-dd). Defaults to today + 1 day.. |

#### `PUT /api/cameras/{cameraId}/status` — Reset camera status

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |
| `resetHour` | query | no | integer | reset specific hour. |

#### `POST /api/cameras/pseudo` — Create pseudo camera

**Body:** `{ description?:string, latitude?:number, longitude?:number, name*:string }`

#### `GET /api/cameras/recommend-engines` — Get recommend engine for camera

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraIds` | query | **yes** | integer | Sets of camera id to get recommend result. |
| `allCameras` | query | no | boolean | allCameras. |
| `excludeEngines` | query | no | string | The engine that does not want to be recommended. — one of: AgeGenderClassifier, CrossCameraTrackingEngine, CrowdDetectionEngine, DwellEngine, ExtraAlertTrigger, FaceGdpr, FaceRecognitionEngine, HumanAttributeEngine, IntrusionEngine, LPREngine, LprGdpr, MakeModelRecognitionEngine, NaturalLanguageEnhancementEngine, ObjectCountingEngine, ObjectLeftBehindEngine, ObjectWrongDirectionEngine, PersonFallEngine, PersonGdpr, PpeClassifier, RecorderEngine, SceneChangeEngine, SpecializedObjectDetectionEngine, Unknown, VehicleCrossCameraTrackingEngine, VideoSearch |

#### `POST /api/cameras/recommend-engines` — Apply recommend engine to camera

**Body:** `array of { ainvrId?:integer, allocatedEngines?:enum[](AgeGenderClassifier|CrossCameraTrackingEngine|CrowdDetectionEngine|DwellEngine|ExtraAlertTrigger|FaceGdpr|FaceRecognitionEngine|HumanAttributeEngine|+24 more), cameraId*:integer, cameraName?:string, cameraStatus?:enum(Error|FailedRetry|Idle|Processing|Unknown), recommendEngines*:RecommendEngine[] }`

#### `GET /api/cameras/uri-schemes` — List schemes for camera url connection

_No parameters._

## ivedaai_camera_state

#### `GET /api/camerastatehistorys` — Find camera state history

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `end` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `timezone` | query | no | string | client timezone. |
| `cameraId` | query | **yes** | integer | cameraId. |

## ivedaai_camera_group

#### `GET /api/camera-groups` — Find camera groups

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `nameContains` | query | no | string | Partial match string. |
| `ainvrIds` | query | no | integer | ainvrIds. |
| `plugins` | query | no | string | plugin has any. |
| `numberOfCameras` | query | no | boolean | Boolean. |
| `fetchCameras` | query | no | boolean | Boolean. |
| `excludeNoCamera` | query | no | boolean | Boolean. |
| `excludeNotInGroup` | query | no | boolean | Boolean. |

#### `POST /api/camera-groups` — Create a camera group

**Body:** `{ cameraGroupId?:string, cameraGroupIds?:string[], cameraIds*:integer[], name*:string }`

#### `DELETE /api/camera-groups/{cameraGroupId}` — Remove camera group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraGroupId` | path | **yes** | string | cameraGroupId. |

#### `GET /api/camera-groups/{cameraGroupId}` — Get camera group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraGroupId` | path | **yes** | string | cameraGroupId. |
| `ainvrIds` | query | no | integer | ainvrIds. |
| `plugins` | query | no | string | plugin has any. — one of: AgeGenderClassifier, CrossCameraTrackingEngine, CrowdDetectionEngine, DwellEngine, ExtraAlertTrigger, FaceGdpr, FaceRecognitionEngine, HumanAttributeEngine, IntrusionEngine, LPREngine, LprGdpr, MakeModelRecognitionEngine, NaturalLanguageEnhancementEngine, ObjectCountingEngine, ObjectLeftBehindEngine, ObjectWrongDirectionEngine, PersonFallEngine, PersonGdpr, PpeClassifier, RecorderEngine, SceneChangeEngine, SpecializedObjectDetectionEngine, Unknown, VehicleCrossCameraTrackingEngine, VideoSearch |

#### `PUT /api/camera-groups/{cameraGroupId}` — Update camera group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraGroupId` | path | **yes** | string | cameraGroupId. |

**Body:** `{ cameraGroupId?:string, cameraGroupIds?:string[], cameraIds*:integer[], name*:string }`

> ⚠️ NOTE: GET /api/camera-groups/{cameraGroupId} returns this field under a different key — cameraIds → cameras[].cameraId (item read only — the collection read returns null). This endpoint replaces the record, so omitted fields revert to their defaults — send the full object. CAUTION: "cameraGroupIds" has no known equivalent in GET /api/camera-groups/{cameraGroupId}, so its current value cannot be read back. Set it explicitly, or accept that it may be reset.

#### `GET /api/camera-groups/{cameraGroupId}/all` — Get camera group for group admin

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraGroupId` | path | **yes** | string | cameraGroupId. |

#### `DELETE /api/camera-groups/{cameraGroupId}/cameras` — Remove cameras from camera group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraGroupId` | path | **yes** | string | cameraGroupId. |

**Body:** `{ cameraGroupId?:string, cameraGroupIds?:string[], cameraIds*:integer[], name*:string }`

#### `PUT /api/camera-groups/{cameraGroupId}/cameras` — Add cameras to camera group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraGroupId` | path | **yes** | string | cameraGroupId. |

**Body:** `{ cameraGroupId?:string, cameraGroupIds?:string[], cameraIds*:integer[], name*:string }`

## ivedaai_cloud_storage

#### `DELETE /api/cloud-storages` — Delete cloud storage

_No parameters._

#### `GET /api/cloud-storages` — Get cloud storage

_No parameters._

#### `POST /api/cloud-storages` — Create cloud storage

**Body:** `{ accessKey?:string, cloudStorageType*:enum(QumuloS3|S3), endpoint?:string, lifecycleRules*:BucketLifecycleRule[], name?:string, region?:string, secretKey?:string, status?:enum(Active|AuthFailed|ConnectBucketFailed|Removed|Unknown) }`

#### `PUT /api/cloud-storages` — Update cloud storage

**Body:** `{ accessKey?:string, cloudStorageType*:enum(QumuloS3|S3), endpoint?:string, lifecycleRules*:BucketLifecycleRule[], name?:string, region?:string, secretKey?:string, status?:enum(Active|AuthFailed|ConnectBucketFailed|Removed|Unknown) }`

#### `POST /api/cloud-storages/buckets` — Create bucket on cloud storage

**Body:** `{ accessKey?:string, cloudStorageType*:enum(QumuloS3|S3), endpoint?:string, lifecycleRules*:BucketLifecycleRule[], name?:string, region?:string, secretKey?:string, status?:enum(Active|AuthFailed|ConnectBucketFailed|Removed|Unknown) }`

#### `POST /api/cloud-storages/buckets/list` — Get bucket list from cloud storage

**Body:** `{ accessKey?:string, cloudStorageType*:enum(QumuloS3|S3), endpoint?:string, lifecycleRules*:BucketLifecycleRule[], name?:string, region?:string, secretKey?:string, status?:enum(Active|AuthFailed|ConnectBucketFailed|Removed|Unknown) }`

#### `GET /api/cloud-storages/object` — Get cloud storage object

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `objectKey` | query | **yes** | string | objectKey. |

#### `POST /api/cloud-storages/regions` — Get region list from cloud storage

**Body:** `{ accessKey?:string, cloudStorageType*:enum(QumuloS3|S3), endpoint?:string, lifecycleRules*:BucketLifecycleRule[], name?:string, region?:string, secretKey?:string, status?:enum(Active|AuthFailed|ConnectBucketFailed|Removed|Unknown) }`

#### `GET /api/cloud-storages/s3` — Get Qumulo S3 image file

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `objectKey` | query | **yes** | string | objectKey. |

## ivedaai_configuration

#### `GET /api/configs` — Find configurations

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `properties` | query | **yes** | string | properties. |

#### `PUT /api/configs/basic` — Apply basic system settings

**Body:** `{ alertSoundId?:integer, alertSoundLoop?:integer, auditRetentionTime?:integer, basicAuth?:boolean, countingResetTime?:string, customMapServerUrl?:string, digestAuth?:boolean, dropCorruptFrame?:boolean, enableAlertAcknowledgement?:boolean, enableCameraAutoConfiguration?:boolean, enableCustomMapServer?:boolean, enableEmotionDetection?:boolean, enableLiveStreaming?:boolean, enableMapView?:boolean, enableObjectOccupancy?:boolean, enablePrivacyProtection?:boolean, enableReportFalseDetection?:boolean, enableUserQueryActivityLogs?:boolean, faceRecognitionQualityLevel?:string, googleMapApiKey?:string, hiddenVehicleModel?:boolean, httpHeaderCoopOrigins?:string, liveReconnectSleep?:integer, logRetentionTime?:integer, lprAllowTypes?:string[], lprPattern?:string, maxCctResultPerNode?:integer, maxResultPerNode?:integer, mode?:enum(Master|Node|Slave|Standalone), playbackDuration?:integer, sslInfo?:SslCertificateInfo, sslPrivateKeyPassPhrase?:string, themeEnable?:string, trackerDebug?:boolean, uploadedChainKey?:string, uploadedPrivateKey?:string, uploadedPublicKey?:string }`

#### `DELETE /api/configs/certificate` — Remove certificate

_No parameters._

#### `GET /api/configs/certificate` — Get certificate details

_No parameters._

## ivedaai_counting

#### `GET /api/counting/dashboard` — Counting dashboard

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss[Z]. |
| `lineSetIds` | query | **yes** | integer | comma seperated integer. |
| `types` | query | **yes** | string | comma seperated types. |

> ⚠️ NOTE: types values must use top-level object-type keys returned by GET /api/types/{category}; do not send a nested synonym, line-set type, or counting direction such as IN/OUT.

#### `GET /api/countings` — Counting history

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss[Z]. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss[Z]. |
| `lineSetIds` | query | **yes** | integer | comma seperated integer. |
| `types` | query | **yes** | string | comma seperated types. |
| `measure` | query | **yes** | string | measurement. — one of: Daily, Fifteen_Minutely, Five_Minutely, Hourly, Minutely, Monthly, Ten_Minutely, Thirty_Minutely, Twenty_Minutely, Weekly |

> ⚠️ NOTE: types values must use top-level object-type keys returned by GET /api/types/{category}; do not send a nested synonym, line-set type, or counting direction such as IN/OUT.

## ivedaai_detection

#### `GET /api/detection/classifiers` — List available classifier

_No parameters._

#### `POST /api/detection/classifiers/{classifierName}` — Do classification

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `classifierName` | path | **yes** | string | Specify classifier to be executed.. |
| `threshold` | formData | no | number | threshold of confidence. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

Pass form fields via the `body` argument.

#### `POST /api/detection/clip/image` — Use clip encode image

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `POST /api/detection/clip/text` — Use clip encode text

**Body:** `array of string`

#### `POST /api/detection/colors` — Detect colors

**File upload:** pass `file: { path, filename?, contentType? }` (required).

**Body:** JSON side-payload sent in multipart text field `request` (an array of color-detection regions).

#### `POST /api/detection/colors.image` — Detect and draw colors

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `label` | formData | no | boolean | label. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

Pass form fields via the `body` argument.

**Body:** JSON side-payload sent in multipart text field `request` (an array of color-detection regions).

#### `POST /api/detection/objects` — Detect objects

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `plugins` | query | no | string | Specify engines to be executed.. — one of: AgeGenderClassifier, CrossCameraTrackingEngine, CrowdDetectionEngine, DwellEngine, ExtraAlertTrigger, FaceGdpr, FaceRecognitionEngine, HumanAttributeEngine, IntrusionEngine, LPREngine, LprGdpr, MakeModelRecognitionEngine, NaturalLanguageEnhancementEngine, ObjectCountingEngine, ObjectLeftBehindEngine, ObjectWrongDirectionEngine, PersonFallEngine, PersonGdpr, PpeClassifier, RecorderEngine, SceneChangeEngine, SpecializedObjectDetectionEngine, Unknown, VehicleCrossCameraTrackingEngine, VideoSearch |
| `profileId` | query | no | integer | Specify a profile id or leave empty to use default profile.. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `POST /api/detection/objects.image` — Detect and draw objects

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `plugins` | query | no | string | Specify engines to be executed.. — one of: AgeGenderClassifier, CrossCameraTrackingEngine, CrowdDetectionEngine, DwellEngine, ExtraAlertTrigger, FaceGdpr, FaceRecognitionEngine, HumanAttributeEngine, IntrusionEngine, LPREngine, LprGdpr, MakeModelRecognitionEngine, NaturalLanguageEnhancementEngine, ObjectCountingEngine, ObjectLeftBehindEngine, ObjectWrongDirectionEngine, PersonFallEngine, PersonGdpr, PpeClassifier, RecorderEngine, SceneChangeEngine, SpecializedObjectDetectionEngine, Unknown, VehicleCrossCameraTrackingEngine, VideoSearch |
| `profileId` | query | no | integer | Specify a profile id or leave empty to use default profile.. |
| `label` | query | no | boolean | label. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `POST /api/detection/plates` — Detect License Plate

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `profileId` | query | no | integer | Specify a profile id or leave empty to use default profile.. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `POST /api/detection/plates.image` — Detect and draw License Plate

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `profileId` | query | no | integer | Specify a profile id or leave empty to use default profile.. |
| `label` | query | no | boolean | label. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

## ivedaai_dwell_history

#### `GET /api/dwellHistories` — Find dwell histories

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | Start datetime in format yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `end` | query | **yes** | string | End datetime in format yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `dwellHistoryId` | query | no | integer | Filter by specific dwell history ID. |
| `localTrackId` | query | no | integer | Filter by local track ID to track a specific object across time. |
| `type` | query | no | string | Filter by object type. — one of: bicycle, bus, car, motorcycle, person, truck, vehicle |
| `cameraId` | query | no | integer | Filter by camera ID. |
| `roiId` | query | no | integer | Filter by ROI (Region of Interest) ID. |
| `dwellTime` | query | no | integer | Filter by minimum dwell time in milliseconds. Returns records with dwell time >= this value. |
| `sceneObjectId` | query | no | integer | Filter by scene object ID. |

## ivedaai_engine_model

#### `GET /api/engineModels` — List AI Models

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `ainvrId` | query | no | integer | long. |

#### `POST /api/engineModels` — Upload AI Model

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `DELETE /api/engineModels/{engineModelId}` — Delete AI Model by Id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `engineModelId` | path | **yes** | integer | engineModelId. |

#### `POST /api/engineModels/{engineModelId}` — Replace AI Model

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `engineModelId` | path | **yes** | integer | engine model id. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `PUT /api/engineModels/{engineModelIds}` — Enable AI Model

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `engineModelIds` | path | **yes** | string | comma seperated ids. |

#### `GET /api/engineModels/configuration` — Get suggested configuration

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | query | no | integer | long. |

#### `GET /api/engineModels/service/status` — Is AI Model Loading

_No parameters._

## ivedaai_engine_object

#### `GET /api/engine-objects` — List EngineObjects

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |

## ivedaai_engine_profile

#### `GET /api/engineProfiles` — Find profiles

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `nameContains` | query | no | string | Name contains. |
| `engineModelIds` | query | no | integer | seperated engine model ids with comma. |
| `isDefault` | query | no | boolean | Boolean. |
| `ainvrId` | query | no | integer | long. |

#### `POST /api/engineProfiles` — Create engine profile

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | query | no | integer | long. |

**Body:** `{ description?:string, engineConfig?:EngineConfigReq, engineModelIds?:integer[], name*:string }`

#### `DELETE /api/engineProfiles/{profileId}` — Delete profile by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `profileId` | path | **yes** | integer | profileId. |

#### `GET /api/engineProfiles/{profileId}` — Find profile by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `profileId` | path | **yes** | integer | profileId. |

#### `PUT /api/engineProfiles/{profileId}` — Update engine profile

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `profileId` | path | **yes** | integer | profileId. |

**Body:** `{ description?:string, engineConfig?:EngineConfigReq, engineModelIds?:integer[], name*:string }`

> ⚠️ NOTE: GET /api/engineProfiles/{profileId} returns this field under a different key — engineModelIds → engineModelId. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it.

#### `POST /api/engineProfiles/default/{engineModelIds}` — Create default profile

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `engineModelIds` | path | **yes** | string | comma seperated ids. |
| `ainvrId` | query | no | integer | long. |

## ivedaai_event

#### `DELETE /api/commonEvents` — Delete events in batch

**Body:** `array of integer`

#### `GET /api/commonEvents` — Find events

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `end` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `timezone` | query | no | string | client timezone. |
| `types` | query | **yes** | string | comma seperated event type. — one of: CROWD_DETECTION, DWELL, FALL, INTRUSION, OBJECT_LEFT_BEHIND, OBJECT_WRONG_DIRECTION, SCENE_CHANGE |
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `roiIds` | query | no | integer | comma seperated integer. |
| `allCameras` | query | no | boolean | select all camera, default false. |

#### `DELETE /api/commonEvents/{commonEventId}` — Delete event by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `commonEventId` | path | **yes** | integer | commonEventId. |

#### `GET /api/commonEvents/{commonEventId}` — Find event by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `commonEventId` | path | **yes** | integer | commonEventId. |

#### `GET /api/commonEvents/latest` — Find latest events

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `types` | query | **yes** | string | comma seperated event type. — one of: CROWD_DETECTION, DWELL, FALL, INTRUSION, OBJECT_LEFT_BEHIND, OBJECT_WRONG_DIRECTION, SCENE_CHANGE |
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `roiIds` | query | no | integer | comma seperated integer. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `size` | query | no | integer | latest n records. |

## ivedaai_external_camera

#### `GET /api/externalCameras/{mappingId}` — Get camera analysis meta

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `mappingId` | path | **yes** | string | mappingId. |
| `applicationId` | query | no | string | applicationId. |

#### `POST /api/externalCameras/{mappingId}` — put camera image

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `mappingId` | path | **yes** | string | mappingId. |
| `applicationId` | formData | no | string | applicationId. |
| `height` | formData | no | integer | height. |
| `latitude` | formData | no | number | latitude. |
| `longitude` | formData | no | number | longitude. |
| `timestamp` | formData | no | integer | timestamp. |
| `width` | formData | no | integer | width. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

Pass form fields via the `body` argument.

#### `GET /api/externalCameras/{mappingId}/meta` — get camera meta

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `mappingId` | path | **yes** | string | mappingId. |

## ivedaai_face

#### `DELETE /api/face` — Delete faceKeys in batch

**Body:** `array of integer`

#### `POST /api/face` — Face detection

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `agQualityLevel` | formData | no | string | — one of: high, low, medium |
| `qualityLevel` | formData | no | string | — one of: high, low, medium |
| `sceneId` | formData | no | integer | |
| `url` | formData | no | string | image url. |

**File upload:** pass `file: { path, filename?, contentType? }` (optional).

Pass form fields via the `body` argument.

#### `DELETE /api/face/{faceKeyId}` — Delete faceKey

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `faceKeyId` | path | **yes** | integer | faceKeyId. |

#### `POST /api/face/search` — Face search

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `allFootages` | query | no | boolean | select all footage, default false. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `descriptor` | query | **yes** | string | face descriptor detected by detection api. |
| `end` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |
| `footageIds` | query | no | integer | comma seperated integer. |
| `limit` | query | no | integer | return size. |
| `scores` | query | no | number | score threshold. |
| `start` | query | **yes** | string | yyyy-MM-dd[ HH:mm:ss[Z]]. |

#### `POST /api/face/similarity` — Face similarity

**Body:** `{ descriptor1?:string, descriptor2?:string }`

#### `POST /api/face/statistics` — Get face statistics

**Body:** `{ ainvrIds?:integer[], by*:enum[](day|hour), cameraIds?:integer[], end?:string, feature?:number[], limit?:integer, start?:string, threshold?:number }`

## ivedaai_face_category

#### `DELETE /api/face/categories` — Delete face categories in batch

**Body:** `array of string`

#### `GET /api/face/categories` — List face categories

_No parameters._

#### `POST /api/face/categories` — Create face category

**Body:** `{ colorCode?:string, name*:string }`

#### `DELETE /api/face/categories/{faceCategoryId}` — Delete face category

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `faceCategoryId` | path | **yes** | string | faceCategoryId. |

#### `PUT /api/face/categories/{faceCategoryId}` — Update face category

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `faceCategoryId` | path | **yes** | string | faceCategoryId. |

**Body:** `{ colorCode?:string, name*:string }`

## ivedaai_face_match

#### `GET /api/face/{faceKeyId}/matches` — Get match list

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `faceKeyId` | path | **yes** | integer | faceKeyId. |

#### `DELETE /api/face/matches` — Delete face match in batch

**Body:** `array of integer`

#### `GET /api/face/matches` — Search face matches

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `footageIds` | query | no | integer | comma seperated integer. |
| `categories` | query | no | string | comma seperated face catetory name, use '-' to query none match. |
| `nameContains` | query | no | string | face target name. |
| `scores` | query | no | number | score threshold. |
| `age` | query | no | string | age filter. — one of: 1-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-100 |
| `gender` | query | no | string | gender filter. — one of: Female, Male, Unknown |
| `emotion` | query | no | string | emotion filter. — one of: Angry, Happy, Neutral, Sad, Surprised, Unknown |
| `hasMask` | query | no | boolean | mask filter. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `allFootages` | query | no | boolean | select all footage, default false. |

#### `DELETE /api/face/matches/{matchId}` — Delete face match

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `matchId` | path | **yes** | integer | matchId. |

#### `GET /api/face/matches/latest` — Latest face matches

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | **yes** | integer | comma seperated integer. |
| `categories` | query | no | string | comma seperated face catetory name, use '-' to query none match. |
| `nameContains` | query | no | string | face target name. |
| `age` | query | no | string | age filter. — one of: 1-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-100 |
| `gender` | query | no | string | gender filter. — one of: Female, Male, Unknown |
| `emotion` | query | no | string | emotion filter. — one of: Angry, Happy, Neutral, Sad, Surprised, Unknown |
| `scores` | query | no | number | score threshold. |
| `hasMask` | query | no | boolean | mask filter. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `size` | query | no | integer | latest n records. |

## ivedaai_face_target

#### `POST /api/face/keys` — Face Target Key Search

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `descriptor` | query | **yes** | string | face descriptor detected by detection api. |
| `limit` | query | no | integer | return size. |
| `scores` | query | no | number | score threshold. |

#### `DELETE /api/face/keys/{targetKeyId}` — Delete face target key

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetKeyId` | path | **yes** | string | faceTargetKeyId. |

#### `GET /api/face/keys/{targetKeyId}` — Find face target key

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetKeyId` | path | **yes** | string | faceTargetKeyId. |

#### `POST /api/face/keys/{targetKeyId}` — Update face target key

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetKeyId` | path | **yes** | string | faceTargetKeyId. |
| `url` | query | no | string | Use external image url. |
| `faceKeyId` | query | no | integer | Use existing faceKeyId from FaceKey. |
| `descriptor` | query | no | string | face feature detected by detection api. |

**File upload:** pass `file: { path, filename?, contentType? }` (optional).

#### `DELETE /api/face/targets` — Delete face targets in batch

**Body:** `array of string`

#### `GET /api/face/targets` — List face targets

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `category` | query | no | string | FaceCategory name. |
| `nameContains` | query | no | string | Partial match name. |

#### `POST /api/face/targets` — Create face target

**Body:** `{ birthYear?:integer, category?:string, description?:string, expiredDate?:string(yyyy-MM-dd), gender?:enum(Female|Male|Unknown), identityNumber?:string, name*:string }`

#### `DELETE /api/face/targets/{targetId}` — Delete face target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | faceTargetId. |

#### `GET /api/face/targets/{targetId}` — Get face target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | targetId. |

#### `PATCH /api/face/targets/{targetId}` — Patch face target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | faceTargetId. |

**Body:** `{ birthYear?:integer, category?:string, description?:string, expiredDate?:string(yyyy-MM-dd), gender?:enum(Female|Male|Unknown), identityNumber?:string, name*:string }`

#### `PUT /api/face/targets/{targetId}` — Update face target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | faceTargetId. |

**Body:** `{ birthYear?:integer, category?:string, description?:string, expiredDate?:string(yyyy-MM-dd), gender?:enum(Female|Male|Unknown), identityNumber?:string, name*:string }`

#### `GET /api/face/targets/{targetId}/keys` — List face target keys

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | faceTargetId. |

#### `POST /api/face/targets/{targetId}/keys` — Add face target key

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | faceTargetId. |
| `descriptor` | formData | no | string | face feature detected by detection api. |
| `faceKeyId` | formData | no | integer | Use existing faceKeyId from FaceKey. |
| `url` | formData | no | string | Use external image url. |

Pass form fields via the `body` argument.

**File upload:** required `file: { path, filename?, contentType? }`, sent as `file`. The API document omits this part.

#### `GET /api/face/targets/export` — Export Face target lists

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `fileType` | query | no | string | Type. |
| `category` | query | no | string | FaceCategory name. |
| `nameContains` | query | no | string | Partial match name. |

#### `GET /api/face/targets/unqualified` — Get unqualified face target list

_No parameters._

## ivedaai_false_report

#### `GET /api/false-report` — Check the connection is available

_No parameters._

#### `POST /api/false-report` — Send false detection report to server

**Body:** `{ description?:string, sceneId?:integer }`

## ivedaai_filter

#### `GET /api/filters` — List filters

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |

#### `POST /api/filters` — Create filter

**Body:** `{ cameraIds?:integer[], name*:string, query?:string, type*:enum(advance|basic) }`

#### `DELETE /api/filters/{filterId}` — Delete filter

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `filterId` | path | **yes** | integer | filterId. |

#### `GET /api/filters/{filterId}` — Find filter by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `filterId` | path | **yes** | integer | filterId. |

#### `PUT /api/filters/{filterId}` — Update filter

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `filterId` | path | **yes** | integer | filterId. |

**Body:** `{ cameraIds?:integer[], name*:string, query?:string, type*:enum(advance|basic) }`

> ⚠️ NOTE: GET /api/filters/{filterId} returns these fields under a different key — cameraIds → expression.cameraIds, query → expression.query, type → expression.type. This endpoint refuses partial bodies outright, so the full object is required regardless.

## ivedaai_footage

#### `DELETE /api/footages` — Delete footages in batch

**Body:** `array of integer`

#### `GET /api/footages` — List footages

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `latitude` | query | no | number | latitude. |
| `longitude` | query | no | number | longitude. |
| `fileName` | query | no | string | Exact string match. |
| `fileNameContains` | query | no | string | Partial match string. |
| `startTime` | query | no | string | yyyy-MM-dd HH:mm:ss. |
| `endTime` | query | no | string | yyyy-MM-dd HH:mm:ss. |
| `statuses` | query | no | string | comma seperated string. — one of: Complete, Failed, Waiting |

#### `DELETE /api/footages/{footageId}` — Delete footage by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `footageId` | path | **yes** | integer | footageId. |

#### `GET /api/footages/{footageId}` — Find footage by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `footageId` | path | **yes** | integer | footageId. |

#### `PUT /api/footages/{footageId}` — Cancel footage by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `footageId` | path | **yes** | integer | footageId. |

## ivedaai_gateway

#### `DELETE /api/gateways` — Delete Gateway in batch

**Body:** `array of string`

#### `GET /api/gateways` — List Gateway

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `name` | query | no | string | name. |
| `macAddress` | query | no | string | macAddress. |

#### `POST /api/gateways` — Create Gateway

**Body:** `{ macAddress*:string, metadata?:JsonObject, name*:string, type*:enum(Xpress), updateDate?:string }`

#### `PUT /api/gateways/{gatewayId}` — Update Gateway

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `gatewayId` | path | **yes** | string | gatewayId. |

**Body:** `{ macAddress*:string, metadata?:JsonObject, name*:string, type*:enum(Xpress), updateDate?:string }`

#### `GET /api/gateways/{gatewayId}/cameras` — List Camera in Gateway

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `gatewayId` | path | **yes** | string | gatewayId. |

## ivedaai_hashtag

#### `GET /api/hashtags` — Find hashtag

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `prefix` | query | no | string | string. |

#### `POST /api/hashtags` — Create hashtag

**Body:** `string`

#### `PUT /api/hashtags` — Setup live hashtag

**Body:** `{ cameraId?:integer, hashtags?:string[] }`

#### `DELETE /api/hashtags/{keyword}` — Delete hashtag

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `keyword` | path | **yes** | string | keyword. |

## ivedaai_identity_recognition

#### `DELETE /api/identity-recognition` — Delete identity recognition in batch

**Body:** `array of integer`

#### `GET /api/identity-recognition` — Identity recognition history

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `categories` | query | no | string | comma seperated face catetory name, use '-' to query none match. |
| `nameContains` | query | no | string | face target name. |
| `dlnContains` | query | no | string | driver license number contains. |
| `granted` | query | no | boolean | access granted or denied. |

#### `GET /api/identity-recognition/config` — Identity recognition config

_No parameters._

#### `GET /api/identity-recognition/latest` — Latest identity recognition

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `categories` | query | no | string | comma seperated face catetory name, use '-' to query none match. |
| `nameContains` | query | no | string | face target name. |
| `dlnContains` | query | no | string | driver license number contains. |
| `granted` | query | no | boolean | access granted or denied. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `size` | query | no | integer | latest n records. |

## ivedaai_image

#### `POST /api/image/rotate` — Image Rotation

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `usrFileName` | formData | no | string | usrFileName. |

Pass form fields via the `body` argument.

**File upload:** required `file: { path, filename?, contentType? }`, sent as `file`. The API document omits this part.

## ivedaai_indoor_map

#### `GET /api/indoor-maps` — List Indoor Maps

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `sorted` | query | no | boolean | |
| `unsorted` | query | no | boolean | |
| `withPermission` | query | **yes** | boolean | Boolean. |

#### `POST /api/indoor-maps` — Create Indoor Map

**Body:** `{ description?:string, floorPlans?:FloorPlanReq[], indoorMapId?:string, latitude?:number, location*:string, longitude?:number, snapshotPath?:string, updateDate?:string }`

#### `DELETE /api/indoor-maps/{indoorMapId}` — Delete Indoor Map by ID

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `indoorMapId` | path | **yes** | string | indoorMapId. |

#### `GET /api/indoor-maps/{indoorMapId}` — Find Indoor Map by ID

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `indoorMapId` | path | **yes** | string | indoorMapId. |

#### `PUT /api/indoor-maps/{indoorMapId}` — Update Indoor Map

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `indoorMapId` | path | **yes** | string | indoorMapId. |

**Body:** `{ description?:string, floorPlans?:FloorPlanReq[], indoorMapId?:string, latitude?:number, location*:string, longitude?:number, snapshotPath?:string, updateDate?:string }`

#### `GET /api/indoor-maps/{indoorMapId}/floor-plans` — Find Floor Plans for Indoor Map

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `indoorMapId` | path | **yes** | string | indoorMapId. |
| `sorted` | query | no | boolean | |
| `unsorted` | query | no | boolean | |

#### `POST /api/indoor-maps/{indoorMapId}/floor-plans` — Create Floor Plans for IndoorMap

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `indoorMapId` | path | **yes** | string | indoorMapId. |

**Body:** `array of { cameras?:CameraReq[], filePath*:string, floorPlanId?:string, indoorMapId?:string, name*:string, thumbnail?:string, updateDate?:string }`

#### `DELETE /api/indoor-maps/floor-plans/{floorPlanId}` — Delete Floor Plan by ID

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `floorPlanId` | path | **yes** | string | floorPlanId. |

#### `GET /api/indoor-maps/floor-plans/{floorPlanId}` — Find Floor Plan by ID

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `floorPlanId` | path | **yes** | string | floorPlanId. |

#### `PUT /api/indoor-maps/floor-plans/{floorPlanId}` — Update Floor Plan

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `floorPlanId` | path | **yes** | string | floorPlanId. |

**Body:** `{ cameras?:CameraReq[], filePath*:string, floorPlanId?:string, indoorMapId?:string, name*:string, thumbnail?:string, updateDate?:string }`

## ivedaai_job

#### `DELETE /api/jobs` — Cancel all jobs

_No parameters._

#### `GET /api/jobs` — Get jobs

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `types` | query | **yes** | string | types. — one of: RetrieveJob, StreamJob, UploadJob |
| `cameraIds` | query | no | integer | cameraIds. |
| `footageIds` | query | no | integer | footageIds. |
| `statuses` | query | no | string | statuses. — one of: Canceled, Completed, Delete, DuplicateExec, Failed, FailedRetry, Running, Suspended, Unknown, Waiting |

#### `POST /api/jobs` — Create job

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `type` | query | **yes** | string | type. — one of: RetrieveJob, StreamJob, UploadJob |
| `cameraId` | query | no | integer | Required for StreamJob and UploadJob. |
| `channel` | query | no | string | Required for RetrieveJob. |
| `startTime` | query | no | string | yyyyMMddHHmmss. |
| `endTime` | query | no | string | yyyyMMddHHmmss. |
| `description` | query | no | string | description. |
| `usrFileName` | query | no | string | usrFileName. |
| `brightness` | query | no | string | brightness. |
| `engineProfileId` | query | no | integer | Required for RetrieveJob and UploadJob. |
| `plugins` | query | no | string | plugins. — one of: AgeGenderClassifier, CrossCameraTrackingEngine, CrowdDetectionEngine, DwellEngine, ExtraAlertTrigger, FaceGdpr, FaceRecognitionEngine, HumanAttributeEngine, IntrusionEngine, LPREngine, LprGdpr, MakeModelRecognitionEngine, NaturalLanguageEnhancementEngine, ObjectCountingEngine, ObjectLeftBehindEngine, ObjectWrongDirectionEngine, PersonFallEngine, PersonGdpr, PpeClassifier, RecorderEngine, SceneChangeEngine, SpecializedObjectDetectionEngine, Unknown, VehicleCrossCameraTrackingEngine, VideoSearch |
| `faceFeatures` | query | no | string | faceFeatures. |
| `url` | query | no | string | url. |
| `gdprThreshold` | query | no | number | gdprThreshold. |
| `nvrId` | query | no | string | Required for RetrieveJob. |
| `channelName` | query | no | string | Required for RetrieveJob. |
| `latitude` | query | no | number | latitude. |
| `longitude` | query | no | number | longitude. |
| `doTranscode` | query | no | boolean | transcode option. |

**File upload:** pass `file: { path, filename?, contentType? }` (optional).

#### `PUT /api/jobs` — Operate all jobs

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `action` | query | **yes** | string | action. — one of: CANCEL, SUSPEND |

> ⚠️ NOTE: this takes no job id and no camera filter — see the operation list for POST /api/jobs/{cameraId}, which cancels one camera's job, before using this one.

#### `POST /api/jobs/{cameraId}` — Cancel job by camera

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |
| `doWait` | query | no | boolean | doWait. |

#### `DELETE /api/jobs/{jobId}` — Delete job by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `jobId` | path | **yes** | integer | jobId. |

#### `GET /api/jobs/{jobId}` — Get job by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `jobId` | path | **yes** | integer | jobId. |

#### `PUT /api/jobs/{jobId}` — Stop job by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `jobId` | path | **yes** | integer | jobId. |

#### `POST /api/jobs/retrieve` — Create retrieve job

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `channel` | query | **yes** | string | |
| `channelName` | query | **yes** | string | |
| `description` | query | no | string | |
| `doTranscode` | query | no | boolean | transcode option. |
| `endTime` | query | **yes** | string | yyyy-MM-dd[T][hh:mm:ss][Z]. |
| `engineProfileId` | query | **yes** | integer | |
| `faceFeatures` | query | no | string[] | |
| `gdprThreshold` | query | no | number | |
| `latitude` | query | no | number | latitude. |
| `longitude` | query | no | number | longitude. |
| `nvrId` | query | **yes** | string | |
| `plugins` | query | no | string[] | |
| `startTime` | query | **yes** | string | yyyy-MM-dd[T][hh:mm:ss][Z]. |

#### `POST /api/jobs/stream` — Create stream job

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | query | **yes** | integer | cameraId. |
| `description` | query | no | string | description. |

#### `POST /api/jobs/upload` — Create upload job

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | formData | **yes** | integer | |
| `description` | formData | no | string | |
| `doTranscode` | formData | no | boolean | transcode option. |
| `engineProfileId` | formData | **yes** | integer | |
| `faceFeatures` | formData | no | string[] | |
| `gdprThreshold` | formData | no | number | |
| `latitude` | formData | no | number | latitude. |
| `longitude` | formData | no | number | longitude. |
| `plugins` | formData | no | string[] | |
| `startTime` | formData | **yes** | string | yyyy-MM-dd[T][hh:mm:ss][Z]. |
| `url` | formData | no | string | |
| `usrFileName` | formData | **yes** | string | |

**File upload:** pass `file: { path, filename?, contentType? }` (optional).

Pass form fields via the `body` argument.

## ivedaai_license

#### `GET /api/hardwareInfo` — Get hardware info

_No parameters._

#### `GET /api/licenses` — Get License

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | integer array. |

#### `POST /api/licenses` — Activate license

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `activationType` | query | no | string | activationType. — one of: MANUAL, ONLINE |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `GET /api/licenses/ainvr` — Get AINVR License

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | **yes** | integer | integer array. |

#### `GET /api/licenses/ainvr/date` — Get license date

_No parameters._

#### `GET /api/licenses/lpr` — Get LPR License

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | query | **yes** | integer | integer. |

## ivedaai_license_plate

#### `DELETE /api/lpr/plates` — Delete license plates in batch

**Body:** `array of integer`

#### `GET /api/lpr/plates` — List license plates

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `footageIds` | query | no | integer | comma seperated integer. |
| `categories` | query | no | string | comma seperated license plate catetory name, use '-' to query none match. |
| `type` | query | no | string | vehicle type. |
| `color` | query | no | string | vehicle color contains. |
| `characters` | query | no | string | license plate character contains. |
| `make` | query | no | string | make contains. |
| `model` | query | no | string | model contains. |
| `country` | query | no | string | country contains. |
| `state` | query | no | string | state contains. |
| `vehicleType` | query | no | string | vehicleType contains. |
| `disabled` | query | no | boolean | disabled. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `allFootages` | query | no | boolean | select all footage, default false. |

#### `DELETE /api/lpr/plates/{licensePlateId}` — Delete license plate

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `licensePlateId` | path | **yes** | integer | licensePlateId. |

#### `PUT /api/lpr/plates/{licensePlateId}` — Update license plate

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `licensePlateId` | path | **yes** | integer | licensePlateId. |

**Body:** `{ characters*:string }`

#### `GET /api/lpr/plates/latest` — Latest license plates

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | comma seperated integer. |
| `cameraIds` | query | **yes** | integer | comma seperated integer. |
| `categories` | query | no | string | comma seperated license plate catetory name, use '-' to query none match. |
| `type` | query | no | string | vehicle type. |
| `color` | query | no | string | vehicle color contains. |
| `characters` | query | no | string | license plate character contains. |
| `make` | query | no | string | make contains. |
| `model` | query | no | string | model contains. |
| `country` | query | no | string | country contains. |
| `state` | query | no | string | state contains. |
| `vehicleType` | query | no | string | vehicleType contains. |
| `disabled` | query | no | boolean | disabled. |
| `size` | query | no | integer | latest n records. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |

## ivedaai_license_plate_category

#### `DELETE /api/lpr/categories` — Delete license plate categories in batch

**Body:** `array of string`

#### `GET /api/lpr/categories` — List license plate categories

_No parameters._

#### `POST /api/lpr/categories` — Create license plate category

**Body:** `{ colorCode?:string, name*:string }`

#### `DELETE /api/lpr/categories/{categoryId}` — Delete license plate category

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `categoryId` | path | **yes** | string | categoryId. |

#### `POST /api/lpr/categories/{categoryId}` — Import license plate target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `categoryId` | path | **yes** | string | category id. |
| `columnSeperator` | query | no | string | Change column seperator used in this file. |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `PUT /api/lpr/categories/{categoryId}` — Update license plate category

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `categoryId` | path | **yes** | string | categoryId. |

**Body:** `{ colorCode?:string, name*:string }`

## ivedaai_license_plate_target

#### `DELETE /api/lpr/targets` — Delete license plate targets in batch

**Body:** `array of string`

#### `GET /api/lpr/targets` — List license plate targets

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `category` | query | no | string | Category name. |
| `plateNumber` | query | no | string | Partial match plate number. |
| `vehicleOwner` | query | no | string | Partial match vehicle owner. |
| `address` | query | no | string | Partial match address. |
| `description` | query | no | string | Partial match description. |

#### `POST /api/lpr/targets` — Create license plate target

**Body:** `{ address?:string, category*:string, description?:string, expiredDate?:string, plateNumber*:string, registrationDate?:string, vehicleOwner?:string }`

#### `DELETE /api/lpr/targets/{targetId}` — Delete license plate target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | targetId. |

#### `GET /api/lpr/targets/{targetId}` — Find license plate target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | targetId. |

#### `PUT /api/lpr/targets/{targetId}` — Update license plate target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `targetId` | path | **yes** | string | targetId. |

**Body:** `{ address?:string, category*:string, description?:string, expiredDate?:string, plateNumber*:string, registrationDate?:string, vehicleOwner?:string }`

#### `GET /api/lpr/targets/export` — Export license plate lists

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `fileType` | query | no | string | Type. |
| `category` | query | no | string | Category name. |
| `plateNumber` | query | no | string | Partial match plate number. |
| `vehicleOwner` | query | no | string | Partial match vehicle owner. |
| `address` | query | no | string | Partial match address. |
| `description` | query | no | string | Partial match description. |

## ivedaai_line_set

#### `GET /api/lineSets` — Find lineSets

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | seperated ainvr ids with comma. |
| `page` | query | no | integer | |
| `size` | query | no | integer | |
| `cameraIds` | query | no | integer | comma separated integer. |
| `nameContains` | query | no | string | line set name contains. |
| `types` | query | no | string | comma separated types. — one of: Dwell, ObjectCounting, ObjectDirection |
| `inCountingEnabled` | query | no | boolean | In counting enabled. |
| `outCountingEnabled` | query | no | boolean | Out counting enabled. |
| `excludeUnused` | query | no | boolean | excludeUnused. |
| `lineSetIds` | query | no | integer | comma separated integer. |

#### `POST /api/lineSets` — Create lineSet

**Body:** `{ cameraId*:integer, inCountingEnabled?:boolean, line1?:string, line2?:string, name*:string, objectTypes?:string[], outCountingEnabled?:boolean, type?:enum(Dwell|ObjectCounting|ObjectDirection) }`

#### `DELETE /api/lineSets/{lineSetId}` — Delete lineSet

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `lineSetId` | path | **yes** | integer | lineSetId. |

#### `GET /api/lineSets/{lineSetId}` — Get lineSet

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `lineSetId` | path | **yes** | integer | lineSetId. |

#### `PATCH /api/lineSets/{lineSetId}` — Patch lineSet

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `lineSetId` | path | **yes** | integer | lineSetId. |

**Body:** `{ cameraId*:integer, inCountingEnabled?:boolean, line1?:string, line2?:string, name*:string, objectTypes?:string[], outCountingEnabled?:boolean, type?:enum(Dwell|ObjectCounting|ObjectDirection) }`

> ⚠️ NOTE: GET /api/lineSets/{lineSetId} returns this field under a different key — cameraId → camera.cameraId. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it.

#### `PUT /api/lineSets/{lineSetId}` — Update lineSet

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `lineSetId` | path | **yes** | integer | lineSetId. |

**Body:** `{ cameraId*:integer, inCountingEnabled?:boolean, line1?:string, line2?:string, name*:string, objectTypes?:string[], outCountingEnabled?:boolean, type?:enum(Dwell|ObjectCounting|ObjectDirection) }`

> ⚠️ NOTE: GET /api/lineSets/{lineSetId} returns this field under a different key — cameraId → camera.cameraId. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it.

## ivedaai_make_model

#### `GET /api/make-models` — Find make model list

_No parameters._

## ivedaai_media

#### `POST /api/media/stream` — Get stream info

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | query | no | integer | cameraId. |
| `doEstimate` | query | no | boolean | doEstimate. |

**Body:** `{ account?:string, cameraType*:enum(App|External|Footage|General|Onvif|RecordedAnalytic|VideoSource), description?:string, detectionMode?:string, doRecording*:boolean, engineConfig?:EngineConfig, engineProfileId*:integer, externalMeta?:ExternalMeta, floorPlanAngle?:integer, floorPlanId?:string, floorPlanX?:number, floorPlanY?:number, frameRate?:number, gpuId?:integer, hwDecode?:boolean, ip?:string, latitude?:number, locationType?:enum(GPS_MAP|INDOOR_MAP|NONE), longitude?:number, manufacturer?:string, model?:string, name?:string, nvrChannel?:string, nvrId?:string, password?:string, plugins?:enum(AgeGenderClassifier|CrossCameraTrackingEngine|CrowdDetectionEngine|DwellEngine|ExtraAlertTrigger|FaceGdpr|FaceRecognitionEngine|HumanAttributeEngine|+17 more), port?:integer, protocol*:enum(Both|TCP|UDP), resolution?:string, roiContour*:VoContour[], schedule?:Schedule, streamUrl?:string }`

## ivedaai_module

#### `DELETE /api/modules` — Uninstall module

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `moduleId` | query | **yes** | string | moduleId. |

#### `GET /api/modules` — Find modules

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `name` | query | no | string | name. |
| `vendor` | query | no | string | vendor. |
| `version` | query | no | string | version. |

#### `POST /api/modules` — Install module

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `PUT /api/modules` — Reload module

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `moduleId` | path | **yes** | string | moduleId. |

#### `GET /api/modules/{moduleId}` — Get module

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `moduleId` | path | **yes** | string | moduleId. |

## ivedaai_multi_factor_authentication

#### `POST /api/mfa/email` — verify mfa

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `access_token` | query | **yes** | string | access_token. |
| `otp_code` | query | **yes** | string | otp_code. |

## ivedaai_nvr

#### `DELETE /api/nvrs` — Delete Nvrs in batch

**Body:** `array of string`

#### `GET /api/nvrs` — List Nvrs

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |

#### `POST /api/nvrs` — Create Nvr

**Body:** `{ account?:string, brandId*:integer, ip*:string, name*:string, password?:string, port*:integer, protocol?:enum(ALL|HTTP|HTTPS|NONE) }`

#### `DELETE /api/nvrs/{nvrId}` — Delete Nvr by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nvrId` | path | **yes** | string | nvrId. |

#### `GET /api/nvrs/{nvrId}` — Find Nvr by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nvrId` | path | **yes** | string | nvrId. |

#### `PUT /api/nvrs/{nvrId}` — Update Nvr

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nvrId` | path | **yes** | string | nvrId. |

**Body:** `{ account?:string, brandId*:integer, ip*:string, name*:string, password?:string, port*:integer, protocol?:enum(ALL|HTTP|HTTPS|NONE) }`

> ⚠️ NOTE: GET /api/nvrs/{nvrId} returns this field under a different key — brandId → brand.brandId. This endpoint refuses partial bodies outright, so the full object is required regardless.

#### `GET /api/nvrs/{nvrId}/cameras` — List cameras by nvr id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nvrId` | path | **yes** | string | nvrId. |
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |

#### `GET /api/nvrs/{nvrId}/channels` — Find Nvr channels

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nvrId` | path | **yes** | string | nvrId. |

#### `GET /api/nvrs/{nvrId}/preview-channel/{channelIndex}` — Preview NVR channel snapshot

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nvrId` | path | **yes** | string | nvrId. |
| `channelIndex` | path | **yes** | string | channelIndex. |
| `protocol` | query | no | string | protocol. — one of: Both, TCP, UDP |

#### `GET /api/nvrs/{nvrType}/alerts` — get the list of alert from NVR

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nvrType` | path | **yes** | string | nvrType. — one of: avigilon, digifort, ocularis |
| `ip` | query | **yes** | string | nvr ip. |
| `port` | query | **yes** | string | nvr port. |
| `username` | query | **yes** | string | nvr username. |
| `password` | query | **yes** | string | nvr password. |
| `cameraIds` | query | no | integer | used for digifort. |

#### `POST /api/nvrs/connection` — Check Nvr connection

**Body:** `{ account?:string, brandId*:integer, ip*:string, name*:string, password?:string, port*:integer, protocol?:enum(ALL|HTTP|HTTPS|NONE) }`

## ivedaai_oauth

#### `POST /api/oauth2/token` — Get token

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `code` | query | no | string | code. |
| `code_verifier` | query | no | string | code_verifier. |
| `grant_type` | query | **yes** | string | grant_type. — one of: authorization_code, client_credentials, password, refresh_token |
| `password` | query | no | string | password. |
| `refresh_token` | query | no | string | refresh_token. |
| `scope` | query | no | string | scope. |
| `username` | query | no | string | username. |

## ivedaai_object_type

#### `GET /api/objectTypes` — List all object types contain synonyms 

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrId` | query | no | integer | ainvr id. |

#### `GET /api/types` — List object types

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | seperated ainvr ids with comma. |

#### `GET /api/types/{category}` — List object types by category

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `category` | path | **yes** | string | category. — one of: animal, car, human, object, others, transportation |
| `ainvrIds` | query | no | integer | seperated ainvr ids with comma. |

## ivedaai_onvif

#### `GET /api/onvif/cameras` — Discover onvif cameras

_No parameters._

#### `POST /api/onvif/rtsps` — List onvif camera rtsp

**Body:** `{ account?:string, cameraType*:enum(App|External|Footage|General|Onvif|RecordedAnalytic|VideoSource), description?:string, detectionMode?:string, doRecording*:boolean, engineConfig?:EngineConfig, engineProfileId*:integer, externalMeta?:ExternalMeta, floorPlanAngle?:integer, floorPlanId?:string, floorPlanX?:number, floorPlanY?:number, frameRate?:number, gpuId?:integer, hwDecode?:boolean, ip?:string, latitude?:number, locationType?:enum(GPS_MAP|INDOOR_MAP|NONE), longitude?:number, manufacturer?:string, model?:string, name?:string, nvrChannel?:string, nvrId?:string, password?:string, plugins?:enum(AgeGenderClassifier|CrossCameraTrackingEngine|CrowdDetectionEngine|DwellEngine|ExtraAlertTrigger|FaceGdpr|FaceRecognitionEngine|HumanAttributeEngine|+17 more), port?:integer, protocol*:enum(Both|TCP|UDP), resolution?:string, roiContour*:VoContour[], schedule?:Schedule, streamUrl?:string }`

## ivedaai_openid

#### `POST /api/openid-providers` — Create OpenID provider

**Body:** `{ clientCredentialScope*:string, clientId*:string, clientSecret*:string, groupClaim*:string, issuer*:string, openidProviderId?:string, redirectUri*:string, updateDate?:string }`

#### `PUT /api/openid-providers/{openidProviderId}` — Update OpenID provider

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `openidProviderId` | path | **yes** | string | openidProviderId. |

**Body:** `{ clientCredentialScope*:string, clientId*:string, clientSecret*:string, groupClaim*:string, issuer*:string, openidProviderId?:string, redirectUri*:string, updateDate?:string }`

#### `POST /api/openid-providers/connection` — Test connect with OpenID provider

**Body:** `{ clientCredentialScope*:string, clientId*:string, clientSecret*:string, groupClaim*:string, issuer*:string, openidProviderId?:string, redirectUri*:string, updateDate?:string }`

## ivedaai_password

#### `GET /api/passwords` — Get available token

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `token` | query | **yes** | string | String. |

#### `POST /api/passwords` — Forget password by email

**Body:** `{ email*:string }`

#### `POST /api/passwords/{keys}` — Reset password by key

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `keys` | path | **yes** | string | keys. |

**Body:** `{ password*:string, username*:string }`

#### `GET /api/passwords/{keys}/expired` — Check if the password reset key has expired

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `keys` | path | **yes** | string | keys. |

## ivedaai_plugin

#### `GET /api/plugins` — List Plugins

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |

#### `POST /api/plugins` — Import Plugin

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `filePath` | formData | no | string | Path to an existing plugin file inside the container; required if no file is uploaded. |
| `password` | formData | **yes** | string | password. |
| `username` | formData | **yes** | string | username. |

**File upload:** pass `file: { path, filename?, contentType? }` (optional).

Pass form fields via the `body` argument.

#### `DELETE /api/plugins/{pluginId}` — Delete Plugin by Id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `pluginId` | path | **yes** | integer | pluginId. |

#### `PATCH /api/plugins/{pluginId}` — Update Plugin metadata by Id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `pluginId` | path | **yes** | integer | pluginId. |

**Body:** `{ description?:string, filePath?:string, isEnabled?:boolean, metadata?:object, name?:string, tempPath?:string, token?:string }`

## ivedaai_resource

#### `GET /api/resources` — List resources

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `direction` | query | no | string | direction. — one of: asc, desc |

#### `GET /api/resources/costs` — Get resource cost of plugin

_No parameters._

#### `POST /api/resources/estimation` — Get estimation resource usage for recommend engines

**Body:** `array of { ainvrId?:integer, allocatedEngines?:enum[](AgeGenderClassifier|CrossCameraTrackingEngine|CrowdDetectionEngine|DwellEngine|ExtraAlertTrigger|FaceGdpr|FaceRecognitionEngine|HumanAttributeEngine|+24 more), cameraId*:integer, cameraName?:string, cameraStatus?:enum(Error|FailedRetry|Idle|Processing|Unknown), recommendEngines*:RecommendEngine[] }`

#### `GET /api/resources/usage` — Get resource information

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `ainvrIds` | query | no | integer | ainvrIds. |

## ivedaai_roi

#### `GET /api/rois` — Find rois

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `ainvrIds` | query | no | integer | separated ainvr ids with comma. |
| `nameContains` | query | no | string | roi name contains. |
| `cameraIds` | query | no | integer | separated camera ids with comma. |
| `types` | query | no | string | comma seperated event type. — one of: CAMERA_ABNORMAL, CROWD_DETECTION, DWELL, FACE_RECOGNITION, FALL, HUMAN_ATTRIBUTE, INTRUSION, LPR, NATURAL_LANGUAGE_ENHANCEMENT, OBJECT_COUNTING, OBJECT_LEFT_BEHIND, OBJECT_WRONG_DIRECTION, SCENE_CHANGE, SPECIALIZED_OBJECT_DETECTION, VEHICLE_CROSS_CAMERA_TRACKING, VENUE, VIDEO_SEARCH |
| `excludeUnused` | query | no | boolean | excludeUnused. |
| `roiIds` | query | no | integer | separated roi ids with comma. |
| `roiParameters` | query | no | string | roiParameters. |

#### `POST /api/rois` — Create roi

**Body:** `{ cameraId*:integer, condition*:RoiTypeReq[], conditionLogic?:enum(and|or), excludeRoiContour?:Contour[], isEnabled?:boolean, name*:string, parameter*:RoiParameter, roiContour*:Contour[], schedule?:Schedule, type?:enum(CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|ILLEGAL_PARKING|INTRUSION|LOITERING|LPR|+2 more) }`

#### `DELETE /api/rois/{roiId}` — Delete roi by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `roiId` | path | **yes** | integer | roiId. |

#### `GET /api/rois/{roiId}` — Find roi by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `roiId` | path | **yes** | integer | roiId. |

#### `PATCH /api/rois/{roiId}` — Patch roi

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `roiId` | path | **yes** | integer | roiId. |

**Body:** `{ cameraId*:integer, condition*:RoiTypeReq[], conditionLogic?:enum(and|or), excludeRoiContour?:Contour[], isEnabled?:boolean, name*:string, parameter*:RoiParameter, roiContour*:Contour[], schedule?:Schedule, type?:enum(CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|ILLEGAL_PARKING|INTRUSION|LOITERING|LPR|+2 more) }`

> ⚠️ NOTE: GET /api/rois/{roiId} returns these fields under a different key — cameraId → camera.cameraId, condition → types, conditionLogic → logical, excludeRoiContour → excludedRegion, isEnabled → enabled, name → eventName, parameter → parameters, roiContour → region[].contour, type → eventType. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it.

#### `PUT /api/rois/{roiId}` — Update roi

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `roiId` | path | **yes** | integer | roiId. |

**Body:** `{ cameraId*:integer, condition*:RoiTypeReq[], conditionLogic?:enum(and|or), excludeRoiContour?:Contour[], isEnabled?:boolean, name*:string, parameter*:RoiParameter, roiContour*:Contour[], schedule?:Schedule, type?:enum(CROWD_DETECTION|DWELL|FACE_RECOGNITION|FALL|ILLEGAL_PARKING|INTRUSION|LOITERING|LPR|+2 more) }`

> ⚠️ NOTE: GET /api/rois/{roiId} returns these fields under a different key — cameraId → camera.cameraId, condition → types, conditionLogic → logical, excludeRoiContour → excludedRegion, isEnabled → enabled, name → eventName, parameter → parameters, roiContour → region[].contour, type → eventType. This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a warning about losing it.

## ivedaai_scene

#### `GET /api/scenes` — Search scenes

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `cameraIds` | query | no | integer | comma seperated integer. |
| `footageIds` | query | no | integer | comma seperated integer. |
| `query` | query | no | string | Valid query string. |
| `hashtags` | query | no | string | hashtag string. |
| `roiPoints` | query | no | number | comma seperated floating point. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `allFootages` | query | no | boolean | select all footage, default false. |

#### `POST /api/scenes` — Create scene

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | formData | **yes** | integer | |
| `datetime` | formData | no | string | [yyyy-MM-dd'T'HH:mm:ss.SSSZ] default to current time. |
| `forceSave` | formData | no | boolean | allow to create the scene without any object, default is false. |
| `frameIndex` | formData | no | integer | |
| `hashtags` | formData | no | string[] | |
| `latitude` | formData | no | number | |
| `longitude` | formData | no | number | |
| `profileId` | formData | no | integer | specific profileId for engines. |
| `requiredEngines` | formData | no | string | specify the required engine. |
| `sceneObjects[0].confidence` | formData | no | number | |
| `sceneObjects[0].h` | formData | **yes** | integer | |
| `sceneObjects[0].metadata.colors` | formData | no | string[] | object color. |
| `sceneObjects[0].metadata.face.age` | formData | no | integer | |
| `sceneObjects[0].metadata.face.ageGroup` | formData | no | string | — one of: -, 1-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-100 |
| `sceneObjects[0].metadata.face.categoryName` | formData | no | string | |
| `sceneObjects[0].metadata.face.categoryUuid` | formData | no | string | |
| `sceneObjects[0].metadata.face.confidence` | formData | no | number | |
| `sceneObjects[0].metadata.face.emotion` | formData | no | string | — one of: Angry, Happy, Neutral, Sad, Surprised, Unknown |
| `sceneObjects[0].metadata.face.features` | formData | **yes** | number[] | |
| `sceneObjects[0].metadata.face.gender` | formData | no | string | — one of: Female, Male, Unknown |
| `sceneObjects[0].metadata.face.matchConfidence` | formData | no | number | |
| `sceneObjects[0].metadata.face.qualified` | formData | no | boolean | |
| `sceneObjects[0].metadata.face.rect.height` | formData | no | integer | |
| `sceneObjects[0].metadata.face.rect.width` | formData | no | integer | |
| `sceneObjects[0].metadata.face.rect.x` | formData | no | integer | |
| `sceneObjects[0].metadata.face.rect.y` | formData | no | integer | |
| `sceneObjects[0].metadata.face.targetName` | formData | no | string | |
| `sceneObjects[0].metadata.face.targetUuid` | formData | no | string | |
| `sceneObjects[0].metadata.licensePlate.categoryId` | formData | no | integer | |
| `sceneObjects[0].metadata.licensePlate.categoryName` | formData | no | string | |
| `sceneObjects[0].metadata.licensePlate.categoryUuid` | formData | no | string | |
| `sceneObjects[0].metadata.licensePlate.confidence` | formData | no | number | |
| `sceneObjects[0].metadata.licensePlate.country` | formData | no | string | |
| `sceneObjects[0].metadata.licensePlate.disabled` | formData | no | boolean | |
| `sceneObjects[0].metadata.licensePlate.number` | formData | no | string | |
| `sceneObjects[0].metadata.licensePlate.rect.height` | formData | no | integer | |
| `sceneObjects[0].metadata.licensePlate.rect.width` | formData | no | integer | |
| `sceneObjects[0].metadata.licensePlate.rect.x` | formData | no | integer | |
| `sceneObjects[0].metadata.licensePlate.rect.y` | formData | no | integer | |
| `sceneObjects[0].metadata.licensePlate.state` | formData | no | string | |
| `sceneObjects[0].metadata.licensePlate.vehicleOwner` | formData | no | string | |
| `sceneObjects[0].metadata.licensePlate.vehicleType` | formData | no | string | |
| `sceneObjects[0].metadata.makeModel.make` | formData | no | string | |
| `sceneObjects[0].metadata.makeModel.model` | formData | no | string | |
| `sceneObjects[0].metadata.makeModel.possibility` | formData | no | number | |
| `sceneObjects[0].metadata.mask.confidence` | formData | no | number | |
| `sceneObjects[0].metadata.mask.hasMask` | formData | no | boolean | |
| `sceneObjects[0].metadata.person.hasHelmet` | formData | no | boolean | |
| `sceneObjects[0].metadata.person.hasVest` | formData | no | boolean | |
| `sceneObjects[0].metadata.person.helmetConfidence` | formData | no | number | |
| `sceneObjects[0].metadata.person.vestConfidence` | formData | no | number | |
| `sceneObjects[0].metadata.speed` | formData | no | string | — one of: AboveAverage, Average, BelowAverage |
| `sceneObjects[0].objectType` | formData | **yes** | string | object type. |
| `sceneObjects[0].w` | formData | **yes** | integer | |
| `sceneObjects[0].x` | formData | **yes** | integer | |
| `sceneObjects[0].y` | formData | **yes** | integer | |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

Pass form fields via the `body` argument.

**Body:** JSON side-payload sent in multipart text field `scene`.

#### `GET /api/scenes/{sceneId}` — Get scene details

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `sceneId` | path | **yes** | integer | sceneId. |

#### `PATCH /api/scenes/{sceneId}` — update scene

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `sceneId` | path | **yes** | integer | sceneId. |

**Body:** `{ hashtags?:string[], latitude?:number, longitude?:number }`

#### `GET /api/scenes/{sceneId}/{type}` — Get original image

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `sceneId` | path | **yes** | integer | sceneId. |
| `type` | path | **yes** | string | type. — one of: Alert, CommonEvent, VideoSearch |
| `eventType` | query | no | string | Required if type equivalent to alert or common-event. — one of: CAMERA_ABNORMAL, CROWD_DETECTION, DWELL, FACE_RECOGNITION, FALL, HUMAN_ATTRIBUTE, INTRUSION, LPR, NATURAL_LANGUAGE_ENHANCEMENT, OBJECT_COUNTING, OBJECT_LEFT_BEHIND, OBJECT_WRONG_DIRECTION, SCENE_CHANGE, SPECIALIZED_OBJECT_DETECTION, VEHICLE_CROSS_CAMERA_TRACKING, VENUE, VIDEO_SEARCH |

#### `GET /api/scenes/{sceneId}/objects` — Get detail objects

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `sceneId` | path | **yes** | integer | sceneId. |
| `commonEventId` | query | no | integer | commonEventId. |
| `query` | query | no | string | query. |

#### `GET /api/scenes/{sceneId}/playback` — Get scene's playback

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `sceneId` | path | **yes** | integer | sceneId. |
| `duration` | query | no | integer | seconds before and after scene time. |
| `start` | query | no | string | yyyy-MM-dd HH:mm:ss. |

#### `POST /api/scenes/image` — Search scenes by image

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `GET /api/scenes/metadata` — Get example of create scene metadata

_No parameters._

#### `GET /api/scenes/objects/count` — Get total number of objects

_No parameters._

## ivedaai_scene_object

#### `GET /api/scene-objects/{id}` — Find scene object by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `id` | path | **yes** | integer | id. |
| `needDescriptor` | query | no | boolean | include object's descriptor in result. |

#### `GET /api/scene-objects/search` — Search similar scene object

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | integer | |
| `size` | query | no | integer | |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `cameraIds` | query | no | integer | comma sperated integer. |
| `footageIds` | query | no | integer | comma seperated integer. |
| `allCameras` | query | no | boolean | select all camera, default false. |
| `allFootages` | query | no | boolean | select all footage, default false. |
| `queryObjIds` | query | **yes** | integer | comma sperated integer. |
| `removedObjIds` | query | no | integer | using deleted scenes as reference images to exclude specific persons from future search results, comma sperated integer. |
| `similarity` | query | no | number | similarity of object. |

#### `POST /api/scene-objects/search` — Search similar scene object

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `allCameras` | query | no | boolean | select all camera, default false. |
| `allFootages` | query | no | boolean | select all footage, default false. |
| `cameraIds` | query | no | integer | comma sperated integer. |
| `descriptors` | query | **yes** | string | the descriptor of the scene object. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `footageIds` | query | no | integer | comma seperated integer. |
| `removedTargetDescriptors` | query | no | string | the descriptor of the removed scene object. |
| `similarity` | query | no | number | similarity of object. |
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `trackType` | query | **yes** | string | the object type of the scene object. — one of: Person, Vehicle |

#### `POST /api/scene-objects/search/image` — Search similar scene object by image

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `allCameras` | formData | no | boolean | select all camera, default false. |
| `allFootages` | formData | no | boolean | select all footage, default false. |
| `cameraIds` | formData | no | integer | comma sperated integer. |
| `end` | formData | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `footageIds` | formData | no | integer | comma seperated integer. |
| `offset` | formData | no | integer | |
| `pageNumber` | formData | no | integer | |
| `pageSize` | formData | no | integer | |
| `paged` | formData | no | boolean | |
| `similarity` | formData | no | number | similarity of object. |
| `sort.sorted` | formData | no | boolean | |
| `sort.unsorted` | formData | no | boolean | |
| `start` | formData | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `trackType` | formData | **yes** | string | the object type of the scene object. — one of: Person, Vehicle |
| `unpaged` | formData | no | boolean | |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

Pass form fields via the `body` argument.

## ivedaai_sound

#### `GET /api/sounds` — List sounds

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `isDeleted` | query | no | boolean | isDeleted. |
| `types` | query | no | string | types. — one of: alert, all, intrusion |

#### `POST /api/sounds` — Upload sound

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `type` | query | **yes** | string | type. — one of: alert, all, intrusion |

**File upload:** pass `file: { path, filename?, contentType? }` (required).

#### `GET /api/sounds/{soundId}` — Find sound by id

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `soundId` | path | **yes** | integer | soundId. |

#### `GET /api/sounds/findByType` — Find sounds by event type

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `type` | query | **yes** | string | type. — one of: alert, all |

## ivedaai_sse

#### `GET /api/system/events` — Server sent event

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `filter` | query | no | string | event filter. — one of: CameraAbnormal, ChannelEstablished, Cluster, ClusterAbnormal, ClusterSync, EngineModelFailed, EngineModelLoaded, EngineModelLoading, Streaming, Tracking |
| `streamCameraIds` | query | no | integer | camera ids to receive camera streaming. |

## ivedaai_statistic

#### `GET /api/statistic/heatmap` — Generate heatmap

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `start` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `end` | query | **yes** | string | yyyy-MM-dd HH:mm:ss. |
| `cameraId` | query | no | integer | camera id. |
| `footageId` | query | no | integer | footage id. |
| `query` | query | no | string | query clause. |
| `fineness` | query | no | integer | fineness setting, lower value for more fineness. [1-16]. |
| `threshold` | query | no | number | max value threshold, value larger than threshold will be adjusted to threshold value. [0.1-1.0]. |
| `forceRefresh` | query | no | boolean | force refresh heatmap. |

## ivedaai_streaming

#### `GET /api/streaming/{cameraId}/{type}.jpg` — Get camera streaming image

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |
| `type` | path | **yes** | string | type. — one of: live |

#### `GET /api/streaming/{cameraId}/{type}.mjpeg` — Get camera streaming motion jpeg

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |
| `type` | path | **yes** | string | type. — one of: live |

## ivedaai_time

#### `GET /api/time` — Find time configurations

_No parameters._

## ivedaai_tracking

#### `PUT /api/cameras/{cameraId}/tracking` — Set AI tracking target

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `cameraId` | path | **yes** | integer | cameraId. |
| `targetId` | query | **yes** | integer | tracking object id, less equal to 0 to clear target. |

## ivedaai_user_group

#### `DELETE /api/user-groups` — Delete user groups in batch

**Body:** `array of string`

#### `GET /api/user-groups` — List user group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `nameContains` | query | no | string | nameContains. |
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |

#### `POST /api/user-groups` — Create user group

**Body:** `{ accountIds?:integer[], externalId*:string, name*:string, privileges?:enum[](AGE_GENDER_READ|AGE_GENDER_WRITE|ALERT_READ|ALERT_WRITE|CAMERA_GROUP_READ|CAMERA_GROUP_WRITE|CAMERA_READ|CAMERA_WRITE|+49 more) }`

#### `DELETE /api/user-groups/{userGroupId}` — Delete user group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |

#### `PATCH /api/user-groups/{userGroupId}` — Patch user group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |

**Body:** `{ accountIds?:integer[], externalId*:string, name*:string, privileges?:enum[](AGE_GENDER_READ|AGE_GENDER_WRITE|ALERT_READ|ALERT_WRITE|CAMERA_GROUP_READ|CAMERA_GROUP_WRITE|CAMERA_READ|CAMERA_WRITE|+49 more) }`

> ⚠️ CAUTION: this endpoint nulls "externalId" if the body omits it, and still returns 200. Send the full object, including the current value of that field. Omitting it is refused by this tool; pass it as null to clear it deliberately.

> ⚠️ NOTE: "accountIds" is not on the record at all, but a second endpoint returns it — read accountIds from GET /api/user-groups/{userGroupId}/accounts at content[].accountId. Read it there if you need the current value.

#### `PUT /api/user-groups/{userGroupId}` — Update user group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |

**Body:** `{ accountIds?:integer[], externalId*:string, name*:string, privileges?:enum[](AGE_GENDER_READ|AGE_GENDER_WRITE|ALERT_READ|ALERT_WRITE|CAMERA_GROUP_READ|CAMERA_GROUP_WRITE|CAMERA_READ|CAMERA_WRITE|+49 more) }`

> ⚠️ NOTE: "accountIds" is not on the record at all, but a second endpoint returns it — read accountIds from GET /api/user-groups/{userGroupId}/accounts at content[].accountId. Read it there if you need the current value.

#### `DELETE /api/user-groups/{userGroupId}/accounts` — Remove user from group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |

**Body:** `array of integer`

#### `GET /api/user-groups/{userGroupId}/accounts` — List user in group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `page` | query | no | object | page number. |
| `size` | query | no | object | page size. |
| `sort` | query | no | object | sorting field and direction(ASC,DESC) seperated with comma.. |
| `userGroupId` | path | **yes** | string | userGroupId. |
| `nameContains` | query | no | string | nameContains. |

#### `POST /api/user-groups/{userGroupId}/accounts` — Add users to group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |

**Body:** `array of integer`

#### `PUT /api/user-groups/{userGroupId}/accounts` — Set users in group

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |

**Body:** `array of integer`

#### `GET /api/user-groups/{userGroupId}/permissions` — List user group permissions

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |
| `type` | query | no | string | type. — one of: Camera, FaceCategory, LicensePlateCategory |

#### `POST /api/user-groups/{userGroupId}/permissions` — Grant user group permissions

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `userGroupId` | path | **yes** | string | userGroupId. |

**Body:** `array of { actions*:enum[](READ|WRITE), id*:string, type*:enum(Camera|FaceCategory|LicensePlateCategory) }`

## ivedaai_utility

#### `POST /api/utility` — Diagnose System

| Parameter | In | Required | Type | Notes |
|---|---|---|---|---|
| `method` | query | **yes** | string | method. |
| `target` | query | **yes** | string | target. |
| `parameters` | query | no | string | parameters. |

## ivedaai_get_schema

Looks up the full JSON schema for any named definition from the spec (e.g. `CameraRequest`). Call with no arguments to list all definition names. Use it when a body summary above is truncated or references a nested type like `Contour` or `Schedule`.

Answers `{name, schema}` for a lookup and `{names}` for the listing — both wrapped rather than bare, because MCP requires `structuredContent` to be an object.

## ivedaai_alert_integration

A guided tool for configuring and testing `AlertRule.trigger` — the mechanism that routes alerts to external systems (generic HTTP webhooks, 13 named VMS/PSIM platforms, email, Immix, mobile push). Built from live testing findings, not the spec alone: several fields the spec marks optional turn out to be required in practice, `mail`/`immix` can't be live-tested, and VMS connection-failure timing is unpredictable (under a second to ~24s observed against the same unreachable address).

Actions: `list_types` (no API call), `test` (calls `POST /api/alertTriggers`), `apply` (attaches the trigger to an existing alert rule via `PATCH /api/alertRules/{alertRuleId}`).

`apply` reads the rule first and re-sends everything the read exposes alongside the new trigger — `name` (returned as `alertName`), `alertType`, `description`, `isEnabled`, plus `weekdays`/`enableForever` from `schedule` and `roiIds`/`cameraIds`/`hashtags`/`typeLogic`/`cooldownInterval` parsed out of the `condition` JSON string, whichever of those the rule's type stores there. It refuses to write if that read fails or comes back without the fields `AlertRuleRequest` marks required. This is belt-and-braces rather than damage control: `PATCH /api/alertRules/{alertRuleId}` was live-tested against a throwaway rule and **merges** — a partial body left every omitted field intact — so applying a trigger does not wipe the rest of the rule. Note that `PUT` on the same path rejects a partial body outright with a 500, so the full object is required there.

```
WEBHOOK:
  request — testable — Generic outbound HTTP webhook — POST/GET/etc. to any URL.
MOBILE:
  mobile — testable — Push notification to the IvedaAI mobile app.
VMS:
  milestone — testable — Milestone VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  genetec — testable — Genetec VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  nx — testable — Nx VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  dw — testable — Dw VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  lux — testable — Lux VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  salient — testable — Salient VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  axis — testable — Axis VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  ocularis — testable — Ocularis VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  digifort — testable — Digifort VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  avigilon — testable — Avigilon VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  hanwha — testable — Hanwha VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  amag — testable — Amag VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
  idis — testable — Idis VMS/PSIM integration. Live-testable, but how long a failed connection takes to report back is unpredictable — repeated tests against the same unreachable address varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions (immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. Use a generous timeout regardless of which VMS type you're testing.
MAIL:
  mail — NOT testable via 'test' — SMTP email notification. Not live-testable via POST /api/alertTriggers (confirmed: returns "Unsupported check connection alert trigger type").
  immix — NOT testable via 'test' — Immix alarm-monitoring-station notification. Shares mail's underlying type; not live-testable either (confirmed).
```

## ivedaai_add_camera

Adds one or more cameras (e.g. from a list of IPs or RTSP URLs) and starts their connection. Built from live testing findings: the raw `CameraRequest` schema's `required` list is misleading (floor-plan fields it lists as required are actually waived by `locationType: "NONE"`), a schema-valid minimal body still throws a bare server-side error unless several other optional-looking fields are also filled (this tool fills them automatically), creating the record is not enough for the camera to connect or appear fully provisioned — a separate `POST /api/cameras/{id}/jobs?activate=true` step is required and performed automatically — and a creation error can still partially create the camera server-side (detected by an exact-name lookup and reported as a failed creation with the matching id for inspection). The match can predate this call, so it is never activated automatically after a creation error.

Only `name` plus `streamUrl` or `ip` are required per camera; `engineProfileId` and `roiContour` default automatically. Activation succeeding is not proof the stream actually connected — check back via `ivedaai_job` (`GET /api/jobs/{jobId}`) or `ivedaai_camera` (`GET /api/cameras/{cameraId}`, look for a populated `status` field).
