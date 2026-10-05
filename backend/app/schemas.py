"""Pydantic request models. Response shapes are plain dicts built in routers."""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class TranscriptSegmentEdit(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class EvidenceIn(BaseModel):
    seg: int = Field(ge=0, le=100000)
    quote: str = Field(min_length=1, max_length=2000)


class SimulatorTaskIn(BaseModel):
    task: Literal["vertical", "timebase", "trigger", "recovery", "free"]
    target_vdiv: Optional[float] = None
    target_sdiv: Optional[float] = None
    target_level: Optional[float] = None
    edge: Optional[Literal["rise", "fall"]] = None
    initial: Optional[dict] = None
    note: Optional[str] = None


class LessonStepIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    instructions: str = Field(min_length=1, max_length=4000)
    rationale: str = Field(default="", max_length=4000)
    success_cues: list[str] = Field(default_factory=list, max_length=20)
    common_mistakes: list[str] = Field(default_factory=list, max_length=20)
    recovery: str = Field(default="", max_length=4000)
    evidence: list[EvidenceIn] = Field(min_length=1, max_length=50)
    simulator: Optional[SimulatorTaskIn] = None


class LessonQuestionIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    question: str = Field(min_length=1, max_length=2000)
    why_missing: str = Field(default="", max_length=2000)
    answer: str = Field(default="", max_length=4000)
    status: Literal["open", "answered", "dismissed"] = "open"


class LessonVersionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=4000)
    steps: list[LessonStepIn] = Field(min_length=1, max_length=50)
    questions: list[LessonQuestionIn] = Field(default_factory=list, max_length=50)
    changelog: str = Field(default="", max_length=1000)


class QuestionAnswerIn(BaseModel):
    answer: Optional[str] = Field(default=None, max_length=4000)
    dismiss: bool = False


class AttemptStepIn(BaseModel):
    step_id: str
    title: str = ""
    passed: bool
    wrong_adjustments: int = Field(ge=0, le=1000, default=0)
    assists: int = Field(ge=0, le=1000, default=0)
    time_ms: int = Field(ge=0, le=86_400_000, default=0)


class AttemptIn(BaseModel):
    trainee_name: str = Field(min_length=1, max_length=80)
    duration_ms: int = Field(ge=0, le=86_400_000, default=0)
    steps: list[AttemptStepIn] = Field(min_length=1, max_length=100)

    @field_validator("trainee_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("trainee_name must not be blank")
        return v
