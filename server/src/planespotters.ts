export interface PlanespottersPhoto {
  thumbnail?: { src?: string };
  thumbnail_large?: { src?: string };
  photographer?: string;
  link?: string;
}

export interface PlanespottersResponse {
  photos?: PlanespottersPhoto[];
}
