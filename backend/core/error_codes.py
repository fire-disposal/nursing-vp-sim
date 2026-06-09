from enum import IntEnum


class ErrorCode(IntEnum):
    # Auth: 1xxx
    INVALID_CREDENTIALS = 1001
    TOKEN_EXPIRED = 1002
    INSUFFICIENT_PERMISSIONS = 1003
    USER_NOT_FOUND = 1004
    USER_ALREADY_EXISTS = 1005

    # Resource: 2xxx
    CASE_NOT_FOUND = 2001
    TRAINING_NOT_FOUND = 2002
    QUESTIONNAIRE_NOT_FOUND = 2003
    NURSING_RECORD_NOT_FOUND = 2004

    # Business: 3xxx
    TRAINING_ALREADY_ENDED = 3001
    SCORING_IN_PROGRESS = 3002
    SCORING_CONFLICT = 3003
    PHASE_ADVANCE_DENIED = 3004

    # Rate limit: 4xxx
    RATE_LIMITED = 4001

    # Server: 5xxx
    LLM_UNAVAILABLE = 5001
    LLM_TIMEOUT = 5002
    INTERNAL_ERROR = 5999


_STATUS_TO_CODE: dict[int, ErrorCode] = {
    400: ErrorCode.INTERNAL_ERROR,
    401: ErrorCode.INVALID_CREDENTIALS,
    403: ErrorCode.INSUFFICIENT_PERMISSIONS,
    404: ErrorCode.INTERNAL_ERROR,
    409: ErrorCode.SCORING_CONFLICT,
    429: ErrorCode.RATE_LIMITED,
    500: ErrorCode.INTERNAL_ERROR,
    502: ErrorCode.LLM_UNAVAILABLE,
    503: ErrorCode.LLM_UNAVAILABLE,
    504: ErrorCode.LLM_TIMEOUT,
}


def status_to_code(status_code: int) -> ErrorCode:
    return _STATUS_TO_CODE.get(status_code, ErrorCode.INTERNAL_ERROR)
