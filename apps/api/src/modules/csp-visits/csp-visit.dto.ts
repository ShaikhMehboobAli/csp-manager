export interface CreateCspVisitCustomerReviewInput {
  customerName?: string;
  customerAccount?: string;
  review?: string;
}

export interface CreateCspVisitInput {
  cspAgentId: string;
  visitDate: Date;
  latitude?: number;
  longitude?: number;
  photoUrl?: string;
  remarks?: string;
  customerReviews: CreateCspVisitCustomerReviewInput[];
}

export interface CspVisitCustomerReviewResponse {
  id: string;
  customerName: string | null;
  customerAccount: string | null;
  review: string | null;
}

export interface CspVisitResponse {
  id: string;
  visitId: string;
  cspAgentId: string;
  visitedByAgentId: string;
  visitDate: Date;
  latitude: number | null;
  longitude: number | null;
  photoUrl: string | null;
  remarks: string | null;
  points: number | null;
  customerReviews: CspVisitCustomerReviewResponse[];
  createdAt: Date;
}
