package api

import (
	"context"
	"net/http"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

func tagFromDB(t db.Tag) Tag {
	return Tag{Id: t.ID, Name: t.Name, GameCount: 0}
}

func (s *StrictServer) ListTags(ctx context.Context, _ ListTagsRequestObject) (ListTagsResponseObject, error) {
	tags, err := s.api.TagService.ListTags(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]Tag, 0, len(tags))
	for _, t := range tags {
		result = append(result, Tag{Id: t.Id, Name: t.Name, GameCount: t.GameCount})
	}

	return ListTags200JSONResponse{Status: "success", Data: result}, nil
}

func (s *StrictServer) CreateTag(ctx context.Context, request CreateTagRequestObject) (CreateTagResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreateTag400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	tag, err := s.api.TagService.CreateTag(ctx, request.Body.Id, name, currentActorID(ctx))
	if err != nil {
		if domainStatusCode(err) == http.StatusConflict {
			return CreateTag409JSONResponse{Status: "fail", Message: "tag with this name already exists"}, nil
		}
		return nil, err
	}

	return CreateTag200JSONResponse{Status: "success", Data: tagFromDB(tag)}, nil
}

func (s *StrictServer) PatchTag(ctx context.Context, request PatchTagRequestObject) (PatchTagResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return PatchTag400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	tag, err := s.api.TagService.UpdateTagName(ctx, parseIDParam(request.Id), name, currentActorID(ctx))
	switch {
	case err == nil:
	case domainStatusCode(err) == http.StatusNotFound:
		return PatchTag404JSONResponse{Status: "fail", Message: "tag not found"}, nil
	case domainStatusCode(err) == http.StatusConflict:
		return PatchTag409JSONResponse{Status: "fail", Message: "tag with this name already exists"}, nil
	default:
		return nil, err
	}

	return PatchTag200JSONResponse{
		Status: "success",
		Data:   Tag{Id: tag.Id, Name: tag.Name, GameCount: tag.GameCount},
	}, nil
}

func (s *StrictServer) DeleteTag(ctx context.Context, request DeleteTagRequestObject) (DeleteTagResponseObject, error) {
	_, err := s.api.TagService.DeleteTag(ctx, parseIDParam(request.Id), currentActorID(ctx))
	switch {
	case err == nil:
	case domainStatusCode(err) == http.StatusNotFound:
		return DeleteTag404JSONResponse{Status: "fail", Message: "tag not found"}, nil
	default:
		return nil, err
	}

	return DeleteTag200JSONResponse{Status: "success", Message: "Tag deleted"}, nil
}

func (s *StrictServer) AddGameTag(ctx context.Context, request AddGameTagRequestObject) (AddGameTagResponseObject, error) {
	err := s.api.TagService.AddGameTag(ctx, parseIDParam(request.Id), request.Body.TagId)
	if err != nil {
		// A foreign-key violation means the game or the tag does not exist;
		// a duplicate attachment is a no-op (ON CONFLICT DO NOTHING).
		if domainStatusCode(err) == http.StatusBadRequest {
			return AddGameTag400JSONResponse{Status: "fail", Message: "game or tag not found"}, nil
		}
		return nil, err
	}

	return AddGameTag200JSONResponse{Status: "success", Message: "Tag added"}, nil
}

func (s *StrictServer) RemoveGameTag(ctx context.Context, request RemoveGameTagRequestObject) (RemoveGameTagResponseObject, error) {
	err := s.api.TagService.RemoveGameTag(ctx, parseIDParam(request.Id), parseIDParam(request.TagId))
	if err != nil {
		return nil, err
	}

	return RemoveGameTag200JSONResponse{Status: "success", Message: "Tag removed"}, nil
}
